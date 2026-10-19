import { expect, test } from '@playwright/test'
import { asc, eq, inArray, sql, type SQL } from 'drizzle-orm'

import { requireDb } from '../../src/db'
import { preHeatTreatmentControls, pstoRepeatCycles, weldJoints } from '../../src/db/schema'
import { getPstoDisplayValue } from '../../src/lib/lnk-status'
import { toHeatTreatmentReportRow } from '../../src/lib/report-control-state'
import { prepareReportRows } from '../../src/lib/use-report-rows'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-column-choice-filter'
import { attachHeatTreatmentControlRelations } from '../../src/server/heat-treatment-control-relations'
import { buildPstoCurrentReportValueSql } from '../../src/server/psto-report-current-values'
import { listColumnFilterOptions, normalizeWeldColumnFilterOptionsRequest } from '../../src/server/weld-read'
import { assertSafeE2eDatabaseUrl, withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const project = 'E2E PSTO current value SQL'
const fields = ['pstoRequest', 'pstoRequestDate', 'pstoDate', 'pstoResult', 'tvmtResult',
  'tvmtConclusionDate', 'pstoCancellationDate', 'pstoControlBasis',
  'heatTreatmentDiagram', 'pstoNote', 'tvmtRequest', 'tvmtRequestDate', 'tvmtConclusion'] as const
type Expected = readonly [string, string, string, string, string, string, string, string]
type ExpectedDocuments = readonly [string, string, string, string, string]
type Cycle = {
  request?: string
  requestDate?: string
  date?: string
  result?: string
  tvmtResult?: string
  conclusionDate?: string
  diagram?: string
  note?: string
  tvmtRequest?: string
  tvmtRequestDate?: string
  conclusion?: string
}
const primaryGood: Cycle = { request: 'PRIMARY', requestDate: '2026-07-01', date: '2026-07-03',
  result: 'проведено', tvmtResult: 'годен', conclusionDate: '2026-07-05', diagram: 'D-PRIMARY',
  note: 'PRIMARY-NOTE', tvmtRequest: 'TVMT-PRIMARY', tvmtRequestDate: '2026-07-04', conclusion: 'C-PRIMARY' }
const primaryBad: Cycle = { ...primaryGood, tvmtResult: 'не годен' }
const secondGood: Cycle = { request: 'REPEAT-2', requestDate: '2026-08-01', date: '2026-08-03',
  result: 'проведено', tvmtResult: 'годен', conclusionDate: '2026-08-05', diagram: 'D-REPEAT-2',
  note: 'REPEAT-2-NOTE', tvmtRequest: 'TVMT-REPEAT-2', tvmtRequestDate: '2026-08-04', conclusion: 'C-REPEAT-2' }
const secondBad: Cycle = { ...secondGood, tvmtResult: 'не годен' }
const thirdGood: Cycle = { request: 'REPEAT-3', requestDate: '2026-09-01', date: '2026-09-03',
  result: 'проведено', tvmtResult: 'годен', conclusionDate: '2026-09-05', diagram: 'D-REPEAT-3',
  note: 'REPEAT-3-NOTE', tvmtRequest: 'TVMT-REPEAT-3', tvmtRequestDate: '2026-09-04', conclusion: 'C-REPEAT-3' }
const sparseSecond: Cycle = { request: 'REQUEST-2', requestDate: '2026-08-01' }
const sparseThird: Cycle = { request: 'REQUEST-3', requestDate: '2026-09-01' }
const waitingSecond: Cycle = { ...sparseSecond, result: 'ожидает', tvmtResult: 'ожидает заявку' }
const waitingThird: Cycle = { ...sparseThird, result: 'ожидает', tvmtResult: 'ожидает заявку' }

// Expected cycle choice and display values are explicit business examples,
// never computed by the SQL builder, getCurrentPstoCycle or getPstoDisplayValue.
const cases: Array<{ joint: string; required: string | null; primary: Cycle; repeats: Cycle[];
  rejectedVik?: boolean; rejectedPreVik?: boolean; hasVik?: string; finalStatus?: string;
  expected: Expected; expectedDocuments?: ExpectedDocuments }> = [
  { joint: 'SQL-CURRENT-01', required: 'да', primary: primaryBad, repeats: [secondBad, thirdGood],
    expected: ['REPEAT-3', '2026-09-01', '2026-09-03', 'проведено', 'годен', '2026-09-05', '', ''],
    expectedDocuments: ['D-REPEAT-3', 'REPEAT-3-NOTE', 'TVMT-REPEAT-3', '2026-09-04', 'C-REPEAT-3'] },
  { joint: 'SQL-CURRENT-02', required: 'да', primary: primaryGood, repeats: [secondBad],
    expected: ['REPEAT-2', '2026-08-01', '2026-08-03', 'проведено', 'не годен', '2026-08-05', '', ''],
    expectedDocuments: ['D-REPEAT-2', 'REPEAT-2-NOTE', 'TVMT-REPEAT-2', '2026-08-04', 'C-REPEAT-2'] },
  { joint: 'SQL-CURRENT-03', required: 'да', primary: primaryGood, repeats: [secondGood, sparseThird],
    expected: ['REQUEST-3', '2026-09-01', '', '', '', '', '', ''] },
  { joint: 'SQL-CURRENT-04', required: 'нет', primary: primaryBad, repeats: [secondGood, waitingThird],
    expected: ['REPEAT-2', '2026-08-01', '2026-08-03', 'проведено', 'годен', '2026-08-05', '', ''],
    expectedDocuments: ['D-REPEAT-2', 'REPEAT-2-NOTE', 'TVMT-REPEAT-2', '2026-08-04', 'C-REPEAT-2'] },
  { joint: 'SQL-CURRENT-05', required: null, primary: primaryBad, repeats: [waitingSecond],
    expected: ['PRIMARY', '2026-07-01', '2026-07-03', 'проведено', 'не годен', '2026-07-05', '', ''],
    expectedDocuments: ['D-PRIMARY', 'PRIMARY-NOTE', 'TVMT-PRIMARY', '2026-07-04', 'C-PRIMARY'] },
  { joint: 'SQL-CURRENT-06', required: 'отменен', primary: primaryBad, repeats: [secondGood, waitingThird],
    expected: ['REPEAT-2', '2026-08-01', '2026-08-03', 'проведено · назначение отменено', 'годен', '2026-08-05', '2026-10-01', 'Отмена по программе'],
    expectedDocuments: ['D-REPEAT-2', 'REPEAT-2-NOTE', 'TVMT-REPEAT-2', '2026-08-04', 'C-REPEAT-2'] },
  { joint: 'SQL-CURRENT-07', required: 'отменен', primary: primaryGood, repeats: [secondBad, waitingThird],
    expected: ['REPEAT-2', '2026-08-01', '2026-08-03', 'проведено · назначение отменено', 'не годен', '2026-08-05', '2026-10-01', 'Отмена по программе'],
    expectedDocuments: ['D-REPEAT-2', 'REPEAT-2-NOTE', 'TVMT-REPEAT-2', '2026-08-04', 'C-REPEAT-2'] },
  { joint: 'SQL-CURRENT-08', required: 'да', primary: primaryGood, repeats: [sparseSecond], rejectedVik: true,
    expected: ['REQUEST-2', '2026-08-01', '', 'нет потребности', '', '', '', ''] },
  { joint: 'SQL-CURRENT-09', required: 'нет', primary: { request: 'PRIMARY-REQUEST', requestDate: '2026-07-01', result: 'ожидает' },
    repeats: [waitingSecond, waitingThird],
    expected: ['REQUEST-3', '2026-09-01', '', 'ожидает', 'ожидает заявку', '', '', ''] },
  { joint: 'SQL-CURRENT-10', required: 'да', primary: {}, repeats: [],
    expected: ['', '', '', 'ожидает заявку', '', '', '', ''] },
  { joint: 'SQL-CURRENT-11', required: 'да', primary: { request: '  PRIMARY-REQUEST  ', requestDate: '2026-07-01' }, repeats: [],
    expected: ['PRIMARY-REQUEST', '2026-07-01', '', 'ожидает', '', '', '', ''] },
  { joint: 'SQL-CURRENT-12', required: 'да', primary: { request: 'PRIMARY-REQUEST', requestDate: '2026-07-01', result: ' ОЖИДАЕТ ЗАЯВКУ ' }, repeats: [],
    expected: ['PRIMARY-REQUEST', '2026-07-01', '', 'ожидает', '', '', '', ''] },
  { joint: 'SQL-CURRENT-13', required: 'да', primary: { result: ' ОЖИДАЕТ ' }, repeats: [],
    expected: ['', '', '', 'ожидает заявку', '', '', '', ''] },
  { joint: 'SQL-CURRENT-14', required: 'нет', primary: { request: 'PRIMARY-REQUEST', requestDate: '2026-07-01' }, repeats: [],
    expected: ['PRIMARY-REQUEST', '2026-07-01', '', '', '', '', '', ''] },
  { joint: 'SQL-CURRENT-15', required: 'отменен', primary: { request: 'PRIMARY-REQUEST', requestDate: '2026-07-01' }, repeats: [],
    expected: ['PRIMARY-REQUEST', '2026-07-01', '', 'отменен', '', '', '2026-10-01', 'Отмена по программе'] },
  { joint: 'SQL-CURRENT-16', required: 'да', primary: { request: 'ожидает заявку', requestDate: '2026-07-01' }, repeats: [],
    expected: ['ожидает заявку', '2026-07-01', '', 'ожидает', '', '', '', ''] },
  { joint: 'SQL-CURRENT-17', required: 'да', primary: {}, repeats: [], finalStatus: 'не годен',
    expected: ['', '', '', 'ожидает заявку', '', '', '', ''] },
  { joint: 'SQL-CURRENT-18', required: 'да', primary: {}, repeats: [], rejectedPreVik: true,
    expected: ['', '', '', 'нет потребности', '', '', '', ''] },
  { joint: 'SQL-CURRENT-19', required: 'да', primary: {}, repeats: [], rejectedPreVik: true, hasVik: 'нет',
    expected: ['', '', '', 'нет потребности', '', '', '', ''] },
  { joint: 'SQL-CURRENT-20', required: 'да', primary: { request: 'LEGACY-PARTIAL', tvmtResult: 'не годен' }, repeats: [], finalStatus: 'не годен',
    expected: ['LEGACY-PARTIAL', '', '', 'ожидает', 'не годен', '', '', ''] },
  { joint: 'SQL-CURRENT-21', required: 'да', primary: primaryGood,
    repeats: [{ ...sparseSecond, tvmtResult: 'не годен' }], finalStatus: 'не годен',
    expected: ['REQUEST-2', '2026-08-01', '', '', 'не годен', '', '', ''] },
]
const expectedRows = cases.map(fixture => [fixture.joint, ...fixture.expected,
  ...(fixture.expectedDocuments ?? ['', '', '', '', ''])])

async function cleanup() {
  await withE2eDatabase(db => db.query(`delete from weld_joint_program_states s using weld_joints w
    where s.weld_joint_id=w.id and w.project_title=$1`, [project]))
  await cleanupLineProgramProjects([project])
}
let storedSettings: { value: string; updated_at: Date } | undefined
test.beforeEach(async () => {
  await cleanup()
  await withLineProgramFixture(async db => {
    storedSettings = (await db.query("select value,updated_at from app_settings where key='control-processes'")).rows[0]
    await db.query(`insert into app_settings(key,value) values ('control-processes',$1)
      on conflict(key) do update set value=excluded.value,updated_at=now()`, [JSON.stringify({ preHeatTreatmentLnkEnabled: true })])
  })
})
test.afterEach(async () => {
  await cleanup()
  await withLineProgramFixture(async db => {
    if (storedSettings) {
      await db.query("update app_settings set value=$1,updated_at=$2 where key='control-processes'", [storedSettings.value, storedSettings.updated_at])
    } else await db.query("delete from app_settings where key='control-processes'")
  })
})

test('ПСТО current SQL: correlated cycles, sparse facts, cancellation and grouped filter options agree', async () => {
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  await withLineProgramFixture(async db => {
    for (const fixture of cases) {
      const { primary } = fixture
      const cancelled = fixture.required === 'отменен'
      const [row] = (await db.query<{ id: number }>(`insert into weld_joints
        (project_title,subtitle_code,line,joint,weld_date,psto_required,has_vik,vik_result,
          psto_request,psto_request_date,psto_date,psto_result,tvmt_result,tvmt_conclusion_date,
          psto_cancellation_date,psto_control_basis,heat_treatment_diagram,psto_note,tvmt_request,tvmt_request_date,tvmt_conclusion,final_status)
        values($1,'CURRENT-SQL','CURRENT-SQL-LINE',$2,'2026-06-01',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        returning id`, [project, fixture.joint, fixture.required, fixture.rejectedVik ? 'да' : fixture.hasVik ?? null,
        fixture.rejectedVik ? 'ремонт' : null, primary.request ?? null, primary.requestDate ?? null, primary.date ?? null,
        primary.result ?? null, primary.tvmtResult ?? null, primary.conclusionDate ?? null,
        cancelled ? '2026-10-01' : null, cancelled ? 'Отмена по программе' : null,
        primary.diagram ?? null, primary.note ?? null, primary.tvmtRequest ?? null, primary.tvmtRequestDate ?? null, primary.conclusion ?? null,
        fixture.finalStatus ?? null])).rows
      if (fixture.rejectedPreVik) await db.query("insert into pre_heat_treatment_controls(weld_joint_id,method,result) values($1,'ВИК','ремонт')", [row!.id])
      for (const [index, cycle] of fixture.repeats.entries()) {
        await db.query(`insert into psto_repeat_cycles
          (weld_joint_id,sequence,psto_request,psto_request_date,psto_date,psto_result,tvmt_result,tvmt_conclusion_date,
            heat_treatment_diagram,psto_note,tvmt_request,tvmt_request_date,tvmt_conclusion)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [row!.id, index + 2, cycle.request ?? null, cycle.requestDate ?? null,
          cycle.date ?? null, cycle.result ?? null, cycle.tvmtResult ?? null, cycle.conclusionDate ?? null,
          cycle.diagram ?? null, cycle.note ?? null, cycle.tvmtRequest ?? null, cycle.tvmtRequestDate ?? null, cycle.conclusion ?? null])
      }
    }
  })
  const db = requireDb()
  const sourceRows = await db.select().from(weldJoints).where(eq(weldJoints.projectTitle, project)).orderBy(asc(weldJoints.joint))
  expect(sourceRows).toHaveLength(cases.length)
  const ids = sourceRows.map(row => row.id)
  const storedCycles = () => db.select().from(pstoRepeatCycles).where(inArray(pstoRepeatCycles.weldJointId, ids))
    .orderBy(asc(pstoRepeatCycles.weldJointId), asc(pstoRepeatCycles.sequence))
  const cyclesBefore = await storedCycles()
  const storedPreControls = () => db.select().from(preHeatTreatmentControls)
    .where(inArray(preHeatTreatmentControls.weldJointId, ids)).orderBy(asc(preHeatTreatmentControls.weldJointId))
  const preControlsBefore = await storedPreControls()
  // Use the actual expressions against PostgreSQL, including the nested SELECT
  // for pstoResult. A JS-only comparison cannot detect a correlation/UNION error.
  const expressions = Object.fromEntries(fields.map(field => [field, buildPstoCurrentReportValueSql(field)!])) as Record<(typeof fields)[number], SQL<string>>
  // Drizzle's single-table SELECT projection strips top-level PgColumn table
  // qualifiers inside a bare SQL expression. That rewrites the correlated
  // repeat lookup into `weld_joint_id = id` on the repeat table. Product WHERE,
  // ORDER BY and wrapped facet expressions retain the qualifiers. Execute the
  // projection directly so this test exercises the same correlated SQL.
  const { rows: sqlRows } = await db.execute<{ joint: string } & Record<(typeof fields)[number], string>>(sql`
    select ${weldJoints.joint}, ${sql.join(fields.map(field => sql`${expressions[field]} as ${sql.identifier(field)}`), sql`, `)}
    from ${weldJoints}
    where ${weldJoints.projectTitle} = ${project}
    order by ${weldJoints.joint}
  `)
  expect(sqlRows.map(row => [row.joint, ...fields.map(field => row[field])]))
    .toEqual(expectedRows)
  const hydrated = await attachHeatTreatmentControlRelations(sourceRows, db)
  // Exercise the same DTO and preparation pipeline as the table, including
  // primary waiting labels. Comparing only a raw accessor misses those labels.
  const prepared = prepareReportRows(hydrated.map(toHeatTreatmentReportRow), [], undefined, undefined, undefined, true, true)
  expect(prepared.map(row => [row.joint, ...fields.map(field => String(getPstoDisplayValue(row, field) ?? ''))]))
    .toEqual(expectedRows)

  const options = (fieldKey: (typeof fields)[number], columnFilters: Record<string, string> = {}) =>
    listColumnFilterOptions(normalizeWeldColumnFilterOptionsRequest({ report: 'heatTreatment', projectTitle: project,
      fieldKey, columnFilters }))
  const expectOptions = async (fieldKey: (typeof fields)[number], expected: Record<string, number>, columnFilters: Record<string, string> = {}) => {
    const actual = await options(fieldKey, columnFilters)
    expect(Object.fromEntries(actual.map(option => [option.value, option.count]))).toEqual(expected)
    expect(actual).toHaveLength(Object.keys(expected).length)
    for (const option of actual) expect(option.label).toBe(option.value || '(пусто)')
  }
  // These call the real grouped query (GROUP BY 1), not direct expression rows
  // regrouped in JavaScript. Blank current fields must remain a separate option.
  await expectOptions('pstoResult', { '': 3, 'проведено': 4, 'проведено · назначение отменено': 2,
    'нет потребности': 3, 'ожидает': 5, 'ожидает заявку': 3, 'отменен': 1 })
  await expectOptions('tvmtResult', { '': 12, 'годен': 3, 'не годен': 5, 'ожидает заявку': 1 })
  await expectOptions('pstoDate', { '': 15, '2026-07-03': 1, '2026-08-03': 4, '2026-09-03': 1 })
  await expectOptions('tvmtConclusionDate', { '': 15, '2026-07-05': 1, '2026-08-05': 4, '2026-09-05': 1 })
  await expectOptions('pstoRequestDate', { '': 6, '2026-07-01': 6, '2026-08-01': 6, '2026-09-01': 3 })
  await expectOptions('pstoDate', { '2026-08-03': 2, '2026-09-03': 1 }, {
    tvmtResult: buildWeldColumnValueFilter(['годен']),
  })
  await expectOptions('pstoResult', { '': 1, 'ожидает': 1, 'проведено': 2, 'проведено · назначение отменено': 1 }, {
    tvmtResult: buildWeldColumnValueFilter(['не годен']),
  })
  await expectOptions('pstoResult', { 'проведено': 2, 'проведено · назначение отменено': 2 }, {
    tvmtConclusionDate: buildWeldColumnValueFilter(['2026-08-05']),
  })
  await expectOptions('pstoResult', { '': 3, 'нет потребности': 3, 'ожидает': 5, 'ожидает заявку': 3, 'отменен': 1 }, {
    pstoDate: buildWeldColumnValueFilter(['']),
  })
  await expectOptions('pstoRequest', { 'LEGACY-PARTIAL': 1, 'PRIMARY-REQUEST': 2, 'REQUEST-3': 1, 'ожидает заявку': 1 }, {
    pstoResult: buildWeldColumnValueFilter(['ожидает']),
  })
  await expectOptions('pstoRequest', { '': 3 }, { pstoResult: buildWeldColumnValueFilter(['ожидает заявку']) })
  await expectOptions('pstoResult', { 'ожидает заявку': 3 }, {
    pstoCycleSummary: buildWeldColumnValueFilter(['Основной · ожидает заявку НК до ТО: ВИК']),
  })

  // Preserve source primary values, sparse nulls and every repeat. Ignore
  // dispatcher-owned fields; this test neither starts nor measures its refresh.
  const sourceFacts = (rows: typeof sourceRows) => rows.map(row => ({ id: row.id, required: row.pstoRequired, hasVik: row.hasVik,
    vikResult: row.vikResult, ...Object.fromEntries(fields.map(field => [field, row[field]])) }))
  const after = await db.select().from(weldJoints).where(eq(weldJoints.projectTitle, project)).orderBy(asc(weldJoints.joint))
  expect(sourceFacts(after)).toEqual(sourceFacts(sourceRows))
  expect(await storedCycles()).toEqual(cyclesBefore)
  expect(await storedPreControls()).toEqual(preControlsBefore)
})
