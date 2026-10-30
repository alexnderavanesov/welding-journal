import { expect, test } from '@playwright/test'
import pg from 'pg'

import { assertSafeE2eDatabaseUrl, withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { asE2eOwner } from '../with-owner-access'

const project = 'E2E exact selection 200k'
const documentTitle = 'EXACT-SHARED-200000'
const relationVersion = '2026-10-01T10:00:00.000Z'

type ExpectedRow = {
  id: number
  line: string
  joint: string
  isometry: string
  version: string
  duplicateId: number
  preId: number
  cycleIds: number[]
}
type Statement = {
  table: string
  sql: string
  parameters: unknown[]
  rows: number | null
  arrayItems: number | null
}

async function cleanup() {
  // These identity tombstones deliberately have no FK cascade.
  await withE2eDatabase(db => db.query(`delete from weld_joint_program_states s using weld_joints w
    where s.weld_joint_id=w.id and w.project_title=$1`, [project]))
  await cleanupLineProgramProjects([project])
}

test.beforeEach(cleanup)
test.afterEach(cleanup)

test('200k: exact off-page IDs retain versions and relations with constant SQL and bounded hydration', async ({}, info) => {
  test.setTimeout(180_000)
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  const documentId = await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,isometry,weld_date,connection_type)
      select $1,'EXACT','EXACT-'||((n-1)/200+1),'F'||((n-1)%200+1),n::text,'2026-07-01','С17'
      from generate_series(1,200000) n`, [project])
    // Twice as many related rows as the largest selection: an unscoped read
    // must fail even if its final JavaScript result is filtered correctly.
    await db.query(`insert into duplicate_controls(weld_joint_id,method,result,control_date,conclusion,conclusion_date,updated_at)
      select id,'ВИК','годен','2026-07-02','DUP-'||id,'2026-07-02',$2
      from weld_joints where project_title=$1 and isometry::int%20=0`, [project, relationVersion])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
      select id,'ВИК','PRE-REQ-'||id,'2026-07-01','годен','PRE-CON-'||id,'2026-07-01'
      from weld_joints where project_title=$1 and isometry::int%20=0`, [project])
    await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_date,psto_result,tvmt_result,tvmt_conclusion)
      select id,sequence,'PSTO-'||id||'-'||sequence,'2026-07-01'::date+sequence,
        '2026-07-01'::date+sequence,'годен','годен','TVMT-'||id||'-'||sequence
      from weld_joints cross join generate_series(2,3) sequence
      where project_title=$1 and isometry::int%20=0`, [project])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=$1 and isometry::int%20=0`, [project])
    const document = (await db.query<{ id: number }>(`insert into generated_documents(type,title,file_name,mime_type,row_count)
      values('weldingJournal',$1,'exact.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',200000)
      returning id`, [documentTitle])).rows[0]!
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select $1,id from weld_joints where project_title=$2`, [document.id, project])
    return document.id
  })
  // Give a known part of the selection a newer MVCC version, independently of
  // updated_at. The reader must return the actual stored xmin for each ID.
  await withLineProgramFixture(db => db.query(`update weld_joints set welding_journal_note='new revision'
    where project_title=$1 and isometry::int%80=0`, [project]))
  const expected = await withE2eDatabase(async db => {
    expect((await db.query('select count(*)::int n from weld_joints where project_title=$1', [project])).rows[0].n).toBe(200_000)
    for (const table of ['weld_joints', 'duplicate_controls', 'pre_heat_treatment_controls', 'psto_repeat_cycles', 'weld_joint_program_states', 'generated_document_weld_joints']) {
      await db.query(`analyze ${table}`)
    }
    return (await db.query<ExpectedRow>(`select w.id,w.line,w.joint,w.isometry,w.xmin::text as version,
      d.id as "duplicateId",p.id as "preId",array_agg(c.id order by c.sequence) as "cycleIds"
      from weld_joints w
      join duplicate_controls d on d.weld_joint_id=w.id
      join pre_heat_treatment_controls p on p.weld_joint_id=w.id
      join psto_repeat_cycles c on c.weld_joint_id=w.id
      where w.project_title=$1 and w.isometry::int%40=0
      group by w.id,w.xmin::text,d.id,p.id order by w.isometry::int desc`, [project])).rows
  })
  expect(expected).toHaveLength(5_000)
  expect(new Set(expected.map(row => row.version)).size).toBe(2)
  const { listWeldJointRowsByIds: rawListWeldJointRowsByIds } = await import('../../src/server/weld-read')
  const listWeldJointRowsByIds = asE2eOwner(rawListWeldJointRowsByIds, 'welding.view')
  const prototype = pg.Client.prototype, original = prototype.query
  let statements: Statement[] = []
  prototype.query = function (this: unknown, ...args: unknown[]) {
    type Callback = (error: Error | null | undefined, reply?: pg.QueryResult) => unknown
    const config = args[0] as string | { text?: string; values?: unknown[]; callback?: Callback }
    const sql = typeof config === 'string' ? config : config.text ?? ''
    const statement: Statement = {
      table: /\bfrom\s+"?(\w+)"?/i.exec(sql)?.[1] ?? 'other', sql,
      parameters: Array.isArray(args[1]) ? args[1] : typeof config === 'object' ? config.values ?? [] : [],
      rows: null, arrayItems: null,
    }
    statements.push(statement)
    const capture = (reply: pg.QueryResult) => {
      statement.rows = reply.rowCount ?? 0
      statement.arrayItems = reply.rows.reduce((total, row: unknown) => total +
        Object.values(row as Record<string, unknown>).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0), 0)
    }
    const observeCallback = (callback: Callback): Callback => function (this: unknown, error, reply) {
      if (reply) capture(reply)
      return callback.call(this, error, reply)
    }
    // Pool.query is a Promise API, but dispatches Client.query with a callback.
    // Capture there before the pool resolves; direct clients can return promises.
    if (typeof args[2] === 'function') args[2] = observeCallback(args[2] as Callback)
    else if (typeof args[1] === 'function') args[1] = observeCallback(args[1] as Callback)
    else if (typeof config === 'object' && typeof config.callback === 'function') {
      args[0] = { ...config, callback: observeCallback(config.callback) }
    }
    const result = (original as (...args: unknown[]) => unknown).apply(this, args)
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<pg.QueryResult>).then(reply => { capture(reply); return reply })
    }
    return result
  } as typeof original
  const measurements: Array<{ selected: number; statements: number; bytes: number; elapsedMs: number;
    reads: Array<Pick<Statement, 'table' | 'rows' | 'arrayItems'>> }> = []
  let baselineStatements: number | undefined
  try {
    for (const count of [10, 1_000, 5_000]) {
      const selection = expected.slice(0, count), ids = selection.map(row => row.id)
      statements = []
      const start = performance.now()
      const rows = await listWeldJointRowsByIds({ data: { ids } })
      const elapsedMs = Math.round(performance.now() - start)
      // Reverse, non-contiguous IDs, plus namesakes on different lines, catch
      // page truncation, accidental whole-line reads and reconstruction by name.
      expect(rows.map(row => row.id)).toEqual(ids)
      expect(rows.map(row => [row.rowVersion, row.line, row.joint, row.isometry])).toEqual(
        selection.map(row => [row.version, row.line, row.joint, row.isometry]),
      )
      expect(rows.map(row => row.duplicateControls)).toEqual(selection.map(row => [{
        id: row.duplicateId, version: relationVersion, weldJointId: row.id, method: 'ВИК', result: 'годен',
        controlDate: '2026-07-02', conclusion: `DUP-${row.id}`, conclusionDate: '2026-07-02',
      }]))
      expect(rows.map(row => row.preHeatTreatmentControls?.map(control => ({
        id: control.id, weldJointId: control.weldJointId, requestName: control.requestName,
        result: control.result, conclusionName: control.conclusionName,
      })))).toEqual(selection.map(row => [{
        id: row.preId, weldJointId: row.id, requestName: `PRE-REQ-${row.id}`, result: 'годен', conclusionName: `PRE-CON-${row.id}`,
      }]))
      expect(rows.map(row => row.pstoRepeatCycles?.map(cycle => ({
        id: cycle.id, weldJointId: cycle.weldJointId, sequence: cycle.sequence,
        pstoRequest: cycle.pstoRequest, pstoDate: cycle.pstoDate, tvmtConclusion: cycle.tvmtConclusion,
      })))).toEqual(selection.map(row => row.cycleIds.map((id, index) => ({
        id, weldJointId: row.id, sequence: index + 2, pstoRequest: `PSTO-${row.id}-${index + 2}`,
        pstoDate: `2026-07-0${index + 3}`, tvmtConclusion: `TVMT-${row.id}-${index + 2}`,
      }))))
      expect(rows.map(row => row.programChainState)).toEqual(selection.map(row => ({
        weldJointId: row.id, kind: 'primary', physicalRootId: row.id, sourceRowId: null,
        coilParentId: null, coilSide: null, replacedByCoil: false, replacementCoilIds: [],
      })))
      expect(rows.map(row => [row.jsrDocumentId, row.jsrDocument])).toEqual(selection.map(() => [documentId, documentTitle]))

      baselineStatements ??= statements.length
      expect(statements.length).toBe(baselineStatements)
      expect(statements.length).toBeLessThanOrEqual(12)
      expect(statements.every(statement => /^\s*select\b/i.test(statement.sql))).toBe(true)
      for (const [table, expectedRows] of [
        ['weld_joints', count], ['duplicate_controls', count], ['pre_heat_treatment_controls', count],
        ['psto_repeat_cycles', count * 2], ['weld_joint_program_states', count], ['generated_document_weld_joints', 1],
      ] as const) {
        const reads = statements.filter(statement => statement.table === table)
        expect(reads, table).toHaveLength(1)
        expect(reads[0]!.rows, `${table}: database rows, before application filtering`).toBe(expectedRows)
        expect(reads[0]!.sql).toMatch(/= any\(\$\d+::integer\[\]\)/)
        const arrays = reads[0]!.parameters.filter(Array.isArray)
        expect(arrays).toHaveLength(1)
        expect([...(arrays[0] as number[])].sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b))
        expect(reads[0]!.parameters.length).toBeLessThanOrEqual(4)
      }
      // The one document covers 200k joints; its grouped query must carry only
      // the requested memberships, never the document's entire composition.
      expect(statements.find(statement => statement.table === 'generated_document_weld_joints')!.arrayItems).toBe(count)
      const bytes = Buffer.byteLength(JSON.stringify(rows))
      expect(bytes).toBeLessThan(count * 5_000 + 4_096)
      measurements.push({ selected: count, statements: statements.length, bytes, elapsedMs,
        reads: statements.map(({ table, rows, arrayItems }) => ({ table, rows, arrayItems })) })
    }
    statements = []
    const ids = expected.slice(0, 10).map(row => row.id)
    const deduplicated = await listWeldJointRowsByIds({ data: { ids: [...ids, ids[0]!, 0, ids[1]!] } })
    expect(deduplicated.map(row => row.id)).toEqual(ids)
    expect(statements.length).toBe(baselineStatements)
    console.info(JSON.stringify({ workflow: 'exact-selection-200k',
      measurements: measurements.map(({ selected, statements, bytes, elapsedMs }) => ({ selected, statements, bytes, elapsedMs })) }))
  } finally {
    prototype.query = original
    await info.attach('exact-selection-query-counts', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
  }
})
