import { expect, test } from '@playwright/test'
import pg from 'pg'
import { writeFile } from 'node:fs/promises'
import { eq, sql } from 'drizzle-orm'
import { performance } from 'node:perf_hooks'
import { withE2eDatabase } from '../database'
import { asE2eOwner } from '../with-owner-access'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { accessContext } from '../../src/server/access-store'
import { createAuditOriginResolver } from '../../src/server/audit-origin-policy'
import { auditSql } from '../../src/server/audited-database'
import { importWeldJoints } from '../../src/server/weld-import'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

const project = 'E2E происхождение истории'
test('import records entered facts separately from server-inherited line properties', async () => {
  const importProject = `${project} импорт`
  let operationId: string | undefined
  try {
    await withE2eDatabase(db => db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'ORIGIN','ORIGIN-LINE','I','Б(а)',100,100)`, [importProject]))
    await asE2eOwner(async function importWithOrigin() {
      const data = { records: [{ projectTitle: importProject, subtitleCode: 'ORIGIN', line: 'ORIGIN-LINE', joint: 'F90801',
        category: null, groupName: null, weldControlPercent: null, weldingJournalNote: 'Из файла' }] }
      const context = accessContext.getStore()!
      context.operation = 'importWeldJoints'
      operationId = context.operationId
      context.auditOrigin = createAuditOriginResolver(context.operation, data, context)
      expect((await importWeldJoints({ data })).inserted).toBe(1)
    }, 'welding.import')()
    await withE2eDatabase(async db => {
      expect((await db.query('select category,group_name,weld_control_percent::float8 as weld_control_percent,welding_journal_note from weld_joints where project_title=$1', [importProject])).rows)
        .toEqual([{ category: 'I', group_name: 'Б(а)', weld_control_percent: 100, welding_journal_note: 'Из файла' }])
      const changes = (await db.query("select changes from audit_changes where operation_id=$1 and entity='weld_joints'", [operationId])).rows
      expect(changes).toHaveLength(1)
      for (const key of ['category', 'groupName', 'weldControlPercent', 'hasVik']) expect(changes[0].changes[key].origin).toBe('automatic')
      expect(changes[0].changes.weldingJournalNote.origin).toBe('user')
      expect(changes[0].changes.joint.origin).toBe('user')
    })
  } finally {
    await cleanupLineProgramProjects([importProject])
    if (operationId) await withE2eDatabase(async db => {
      await db.query('delete from audit_changes where operation_id=$1', [operationId])
      await db.query('delete from audit_operations where id=$1', [operationId])
    })
  }
})

test('audit provenance preserves atomic rollback and bulk SQL counts without rewriting older history', async ({}, info) => {
  const rows = await withE2eDatabase(async db => (await db.query(`insert into weld_joints(project_title,line,joint,welding_journal_note)
    select $1,'AUDIT-ORIGIN','F'||i,'исходное' from generate_series(1,1000) i returning id`, [project])).rows)
  const operations: string[] = []
  const measurements: Array<{ classified: boolean; ms: number; sql: number; bytes: number }> = []
  const query = pg.Client.prototype.query
  let statements = 0
  const run = asE2eOwner(async function originBatch(classified: boolean, value: string, rollback = false, nestedRollback = false) {
    // Include capture of submitted values in the measured operation, not only
    // the database write: provenance preparation must remain inexpensive too.
    const before = statements, start = performance.now()
    const context = accessContext.getStore()!
    context.operation = 'massFillWeldJoints'
    operations.push(context.operationId)
    const data = { records: rows.map(row => ({ id: row.id, weldingJournalNote: value })) }
    if (classified) context.auditOrigin = createAuditOriginResolver(context.operation, data)
    await requireDb().transaction(async tx => {
      await tx.update(weldJoints).set({ weldingJournalNote: value }).where(eq(weldJoints.projectTitle, project))
      await auditSql(tx, [{ table: weldJoints, where: eq(weldJoints.projectTitle, project) }], () => tx.execute(sql`update weld_joints set final_status=${classified ? 'годен' : 'ожидает НК'} where project_title=${project}`))
      if (nestedRollback) {
        await expect(tx.transaction(async nested => {
          await nested.update(weldJoints).set({ weldingJournalNote: 'отменённое вложенное изменение' }).where(eq(weldJoints.projectTitle, project))
          throw new Error('nested rollback')
        })).rejects.toThrow('nested rollback')
      }
      if (rollback) throw new Error('whole rollback')
    })
    return { sql: statements - before, ms: performance.now() - start, operationId: context.operationId }
  }, 'welding.edit')
  try {
    pg.Client.prototype.query = function(this: pg.Client, ...args: unknown[]) {
      statements++
      return (query as (...values: unknown[]) => unknown).apply(this, args)
    } as typeof query
    for (let index = 0; index < 6; index++) {
      const classified = index % 2 === 1
      const measured = await run(classified, `изменение ${index}`)
      const saved = await withE2eDatabase(async db => (await db.query('select changes from audit_changes where operation_id=$1 order by id', [measured.operationId])).rows)
      expect(saved).toHaveLength(1000)
      expect(saved.every(row => row.changes.weldingJournalNote.after === `изменение ${index}`)).toBe(true)
      expect(saved.every(row => row.changes.weldingJournalNote.origin === (classified ? 'user' : undefined))).toBe(true)
      expect(saved.every(row => row.changes.finalStatus.origin === (classified ? 'automatic' : undefined))).toBe(true)
      measurements.push({ classified, ms: measured.ms, sql: measured.sql, bytes: Buffer.byteLength(JSON.stringify(saved)) })
    }
    // Metadata is attached to existing batched inserts: no additional queries,
    // history rows or post-save requests are needed for any of the 1000 joints.
    expect(new Set(measurements.map(item => item.sql)).size).toBe(1)
    const legacy = await withE2eDatabase(async db => (await db.query('select id,changes from audit_changes where operation_id=$1 order by id', [operations[0]])).rows)
    await expect(run(true, 'отменённое', true)).rejects.toThrow('whole rollback')
    const failedOperation = operations.at(-1)
    await withE2eDatabase(async db => {
      expect((await db.query('select count(*)::int as count from audit_changes where operation_id=$1', [failedOperation])).rows[0].count).toBe(0)
      expect((await db.query('select count(*)::int as count from audit_operations where id=$1', [failedOperation])).rows[0].count).toBe(0)
      expect((await db.query('select distinct welding_journal_note from weld_joints where project_title=$1', [project])).rows).toEqual([{ welding_journal_note: 'изменение 5' }])
    })
    await run(true, 'сохранённое', false, true)
    await withE2eDatabase(async db => {
      const result = (await db.query('select changes from audit_changes where operation_id=$1', [operations.at(-1)])).rows
      expect(result).toHaveLength(1000)
      expect(result.every(row => row.changes.weldingJournalNote.after === 'сохранённое' && row.changes.weldingJournalNote.origin === 'user')).toBe(true)
      expect((await db.query('select id,changes from audit_changes where operation_id=$1 order by id', [operations[0]])).rows).toEqual(legacy)
    })
    const concurrent = await Promise.all([run(true, 'параллельно с отметками'), run(false, 'параллельно без отметок')])
    for (const [index, operation] of concurrent.entries()) {
      const saved = await withE2eDatabase(async db => (await db.query('select changes from audit_changes where operation_id=$1', [operation.operationId])).rows)
      expect(saved).toHaveLength(1000)
      expect(saved.every(row => row.changes.weldingJournalNote.origin === (index === 0 ? 'user' : undefined))).toBe(true)
    }
    await writeFile(info.outputPath('bulk-origin-measurements.json'), JSON.stringify(measurements, null, 2))
  } finally {
    pg.Client.prototype.query = query
    await withE2eDatabase(async db => {
      await db.query('delete from audit_changes where operation_id=any($1::text[])', [operations])
      await db.query('delete from audit_operations where id=any($1::text[])', [operations])
      await db.query('delete from weld_joints where project_title=$1', [project])
    })
  }
})
