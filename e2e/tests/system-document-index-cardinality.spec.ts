import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { sql, type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { requireDb } from '@/db'
import { rebuildSystemDocumentIndexInTransaction } from '@/server/system-document-index'

test('initial document index: 400000 distinct conclusions keep exact memberships with bounded joins', async ({}, info) => {
  test.skip(process.env.AUDIT_CHAIN_SCALE !== '1', 'Requires the owned 200000-joint background')
  test.setTimeout(180_000)
  const measurements: Array<{ statement: string, ms: number }> = []
  let plan: unknown
  const started = performance.now()
  let warmPid: unknown
  await requireDb().transaction(async tx => {
    warmPid = (await tx.execute(sql`select pg_backend_pid() pid`)).rows[0].pid
    await tx.execute(sql`insert into generated_documents(type,title,file_name,mime_type,row_count)
      select 'weldingJournal','Warm FK '||n,'warm.xlsx','application/octet-stream',1
      from generate_series(1,12) n`)
    await tx.execute(sql`analyze generated_documents`)
    await tx.execute(sql`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select id,1 from generated_documents where type='weldingJournal'`)
  })
  try {
    await requireDb().transaction(async tx => {
      // A database deadline also cancels the SQL when a regression would leave
      // the test runner waiting on a transaction after its UI deadline.
      await tx.execute(sql`set local statement_timeout = '45s'`)
      // A long-lived application connection has already checked document FKs
      // against a small registry before the first large legacy-index rebuild.
      // A fresh connection alone misses plans cached by those FK checks.
      expect((await tx.execute(sql`select pg_backend_pid() pid`)).rows[0].pid).toBe(warmPid)
      const measured = {
        execute: async (query: SQL) => {
          const statement = new PgDialect().sqlToQuery(query).sql
          if (/insert into "generated_document_weld_joints"/.test(statement)) {
            plan = (await tx.execute(sql`explain (format json) ${query}`)).rows
            await writeFile(info.outputPath('membership-plan.json'), JSON.stringify(plan, null, 2))
          }
          const start = performance.now()
          try { return await tx.execute(query) }
          finally { measurements.push({ statement: statement.replace(/\s+/g, ' ').slice(0, 160), ms: Math.round(performance.now() - start) }) }
        },
      }
      await rebuildSystemDocumentIndexInTransaction(measured as never, 'lnkConclusion')
      const actual = (await tx.execute(sql`select
        count(*)::int positions, count(distinct d.id)::int documents,
        count(*) filter(where d.row_count <> 1 or d.title <> case d.type
          when 'system:lnkConclusionVik' then w.vik_conclusion
          when 'system:lnkConclusionRk' then w.rk_conclusion else 'unexpected' end
          or d.period_from is distinct from w.weld_date)::int mismatches
        from generated_document_weld_joints a join generated_documents d on d.id=a.document_id
        join weld_joints w on w.id=a.weld_joint_id where w.project_title='E2E chain-scale background'`)).rows[0]
      expect(actual).toEqual({ positions: 400_000, documents: 400_000, mismatches: 0 })
    })
  } finally {
    const result = { ms: Math.round(performance.now() - started), measurements, plan }
    console.log('DOCUMENT_INDEX_CARDINALITY', JSON.stringify({ ms: result.ms, measurements }))
    await writeFile(info.outputPath('document-index-cardinality.json'), JSON.stringify(result, null, 2))
  }
})
