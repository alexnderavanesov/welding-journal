import { asE2eOwner } from '../with-owner-access'
import { buildWeldColumnFilterOptionsFromRows, projectPstoReportDisplayValues } from '../../src/server/report-filter-reference.test-helper'
import { buildReportQueryWhere, buildServerReportRows, listReportPage, listColumnFilterOptions, normalizeWeldPageRequest, normalizeWeldColumnFilterOptionsRequest, getWeldReportSummary as raw_getWeldReportSummary , readReportOutputSnapshot as raw_readReportOutputSnapshot } from '../../src/server/weld-read'
import { LNK_METHODS } from '../../src/lib/report-config'
import type { WeldFieldKey } from '../../src/lib/weld-fields'
import type { WeldJoint } from '../../src/db/schema'
import type { WeldRow } from '../../src/lib/dispatcher-types'
import { test, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { eq, sql } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { appSettings, weldJoints } from '../../src/db/schema'
import { DEFAULT_OTHER_SETTINGS, DEFAULT_WDI_CALCULATION_RULES, type OtherSettings } from '../../src/lib/other-settings'
import { PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS, getPreHeatTreatmentReportValue } from '../../src/lib/pre-heat-treatment-report-fields'
import { getRkExposureSchemeState } from '../../src/lib/rk-exposure'
import { calculateWdi } from '../../src/lib/wdi'
import { filterWeldRowsByColumns } from '../../src/lib/weld-table-filtering'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-column-choice-filter'
import { PROJECT_SETTING_KEYS } from '../../src/lib/project-settings-remote'
import { buildCalculatedReportValueSql } from '../../src/server/report-calculated-values-sql'
import { buildCalculatedFilterWhere } from '../../src/server/report-filter-text-sql'
import { attachHeatTreatmentControlRelations } from '../../src/server/heat-treatment-control-relations'
import { ensureDispatcherTaskIndexFresh, isDispatcherTaskIndexFresh } from '../../src/server/dispatcher-task-index'
import { assertSafeE2eDatabaseUrl } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const project = 'E2E calculated value parity'
test.beforeEach(async () => {
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  await cleanupLineProgramProjects([project])
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,line,joint,weld_date,connection_type,d1,d2,t1,t2,wdi,
      has_vik,has_rk,has_uzk,has_pvk,vik_result,rk_result,uzk_result,pvk_result,
      psto_required,psto_request,psto_result,tvmt_request,tvmt_result,lnk_defect_description,rk_exposure_confirmed_diameter)
      select $1,'PARITY','F'||n,'2026-06-01',case when n%2=0 then 'У19' else 'С17' end,
        case when n%7=0 then null else 114 end,case when n%11=0 then null else 245 end,6,12,9.9,
        (array['да','отменен',null,'дополнительный'])[n%4+1],
        (array['да','отменен',null,'дополнительный'])[(n+1)%4+1],'да','да',
        'годен',(array['годен','ремонт','вырез','ожидает НК',null,'ГОДЕН (отменен)'])[n%6+1],'годен','годен',
        (array['да','отменен',null])[n%3+1],case when n%4<>0 then 'P-'||n end,
        (array['проведено',null,'ожидает','отменен'])[n%4+1],
        case when n%5<>0 then 'T-'||n end,(array['годен','не годен',null,'ожидает'])[n%4+1],
        (array['0: ДНО'||chr(10)||'120: A: B',' 0: '||chr(13)||chr(10)||'120: ДНО',
          'solo'||chr(10)||': ignored'||chr(10)||' X: 50%_A',null])[n%4+1],
        case when n%5=0 then 500 else 114 end
      from generate_series(1,36) n`, [project])
    await db.query(`update weld_joints set
      vik_request='ВИК-А', rk_request='РК-Б', uzk_request='УЗК-50%_A', pvk_request='ПВК-В',
      vik_request_date='2026-05-31', rk_request_date='2026-06-01', uzk_request_date='2026-06-02', pvk_request_date='2026-06-03',
      vik_conclusion='В-1', rk_conclusion='Р-1', uzk_conclusion='У-1', pvk_conclusion='П-1',
      vik_conclusion_date='2026-06-02', rk_conclusion_date='2026-06-03', uzk_conclusion_date='2026-06-04', pvk_conclusion_date='2026-06-05',
      vik_control_basis='проект', rk_control_basis='50%_A', psto_note='Примечание'
      where project_title=$1 and substring(joint from 2)::int%3=0`, [project])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,result,defect_description)
      select id,method,case when substring(joint from 2)::int%3<>0 then 'R-'||method end,
        (array['годен','ремонт','вырез',null,'ожидает',' ГОДЕН '])[substring(joint from 2)::int%6+1],
        lnk_defect_description from weld_joints cross join unnest(array['ВИК','РК','УЗК','ПВК']) method
      where project_title=$1 and substring(joint from 2)::int%5<>0`, [project])
    await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_result,tvmt_request,tvmt_result)
      select id,sequence,case when sequence=2 then 'REPEAT' end,case when sequence=2 then 'проведено' end,
        case when sequence=2 then 'TVMT' end,case when sequence=2 then 'годен' end
      from weld_joints cross join generate_series(2,3) sequence
      where project_title=$1 and substring(joint from 2)::int%2=0`, [project])
  })
  // These are stable-value comparisons. A refresh requested by a preceding
  // browser scenario can otherwise publish final statuses between page-ID
  // selection and card hydration, legitimately tripping the version guard.
  expect(isDispatcherTaskIndexFresh(await ensureDispatcherTaskIndexFresh())).toBe(true)
})
test.afterEach(() => cleanupLineProgramProjects([project]))

test('SQL preserves pre-TO facts, cancellation, no-need, text parsing and literal filter operators', async () => {
  const db = requireDb()
  const where = eq(weldJoints.projectTitle, project)
  const rows = await attachHeatTreatmentControlRelations(await db.select().from(weldJoints).where(where))
  for (const field of PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS) {
    const expression = buildCalculatedReportValueSql('lnk', field, DEFAULT_OTHER_SETTINGS)!
    const values = await db.select({ id: weldJoints.id, value: expression as ReturnType<typeof sql<string>> }).from(weldJoints).where(where)
    const expected = new Map(rows.map(row => [row.id, String(getPreHeatTreatmentReportValue({ ...row, preHeatTreatmentLnkEnabled: true } as WeldRow, field) ?? '')]))
    for (const value of values) assert.equal(String(value.value ?? ''), expected.get(value.id), `${field}:${value.id}`)
  }
  const field = 'preRkResult' as const
  const expression = buildCalculatedReportValueSql('lnk', field, DEFAULT_OTHER_SETTINGS)!
  for (const filter of ['рем', '=ГОДЕН', '%', '_', '\\', buildWeldColumnValueFilter(['годен', '']), buildWeldColumnValueFilter(['ГОДЕН']),
    buildWeldColumnValueFilter([...Array.from({ length: 200 }, (_, i) => `Other ${i}`), 'ремонт', '']),
    '__column_choice_filter__:' + encodeURIComponent(JSON.stringify({ kind: 'values', values: [] })),
  ]) {
    const filtered = await db.select({ id: weldJoints.id }).from(weldJoints).where(sql`${where} and ${buildCalculatedFilterWhere(expression, filter)}`)
    const projected = rows.map(row => ({ ...row, [field]: getPreHeatTreatmentReportValue({ ...row, preHeatTreatmentLnkEnabled: true } as WeldRow, field) }))
    assert.deepEqual(filtered.map(row => row.id).sort((a,b) => a-b), filterWeldRowsByColumns(projected, { [field]: filter }).map(row => row.id).sort((a,b) => a-b), filter)
  }
  // Independent facts: first stored pre-RK result is a rejection but a cancelled
  // assignment annotates it; a method without its own final result is no-need
  // only when an assigned/cancelled pre-method has actually rejected.
  const first = rows.find(row => row.joint === 'F1')!
  expect(getPreHeatTreatmentReportValue(first, 'preVikResult')).toBe('ремонт · назначение отменено')
  expect(getPreHeatTreatmentReportValue(rows.find(row => row.joint === 'F5')!, 'prePvkResult')).toBeUndefined()
})

test('SQL WDI and exposure schemes preserve settings, boundaries, order and missing values', async () => {
  const db = requireDb(), where = eq(weldJoints.projectTitle, project)
  const rows = await db.select().from(weldJoints).where(where)
  const configurations: OtherSettings[] = [
    { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula', wdiCalculationRules: DEFAULT_WDI_CALCULATION_RULES },
    { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'table', wdiTable: {
      fileName: 'fixture', uploadedAt: '', diameters: [100, 114, 245], thicknesses: [6, 12], values: [[1,2],[3,null],[5,6]],
    } },
  ]
  for (const settings of configurations) {
    const values = await db.select({ id: weldJoints.id, value: buildCalculatedReportValueSql('lnk', 'wdi', settings) as ReturnType<typeof sql<number>> }).from(weldJoints).where(where)
    for (const item of values) assert.equal(item.value == null ? null : Number(item.value), calculateWdi(rows.find(row => row.id === item.id)!, settings))
  }
  const settings: OtherSettings = { ...DEFAULT_OTHER_SETTINGS, rkExposureTable: {
    fileName: 'fixture', uploadedAt: '', entries: [
      { diameter: 100, options: [{ label: 'A', values: ['0', '120'], isDefault: true, note: '' }] },
      { diameter: 200, options: [{ label: 'B', values: ['0', '120'], isDefault: true, note: '' }] },
    ],
  } }
  const largeTable = { fileName: 'large configuration', uploadedAt: '', entries: Array.from({ length: 300 }, (_, i) => ({
    diameter: i + 1, options: Array.from({ length: 4 }, (_, j) => ({ label: `Схема ${i}/${j}`,
      values: j === 0 ? ['0', '120'] : [String(j)], isDefault: j === 0, note: '' })),
  })) }
  for (const table of [null, settings.rkExposureTable, largeTable]) {
    const values = await db.select({ id: weldJoints.id, value: buildCalculatedReportValueSql('lnk', 'rkExposureScheme', { ...settings, rkExposureTable: table }) as ReturnType<typeof sql<string>> }).from(weldJoints).where(where)
    for (const item of values) assert.equal(item.value, getRkExposureSchemeState(rows.find(row => row.id === item.id)!, table).label)
  }
})

test('current cycle SQL summary matches active/inactive, sparse repeats and stage settings', async () => {
  const db = requireDb(), where = eq(weldJoints.projectTitle, project)
  const [previous] = await db.select().from(appSettings).where(eq(appSettings.key, PROJECT_SETTING_KEYS.controlProcesses))
  try {
    for (const enabled of [true, false]) {
      await db.insert(appSettings).values({ key: PROJECT_SETTING_KEYS.controlProcesses, value: JSON.stringify({ preHeatTreatmentLnkEnabled: enabled }) })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify({ preHeatTreatmentLnkEnabled: enabled }) } })
      const rows = await attachHeatTreatmentControlRelations(await db.select().from(weldJoints).where(where))
      const projected = projectPstoReportDisplayValues<WeldRow>(rows, ['pstoCycleSummary'])
      const values = await db.select({ id: weldJoints.id, value: buildCalculatedReportValueSql('heatTreatment', 'pstoCycleSummary', DEFAULT_OTHER_SETTINGS) as ReturnType<typeof sql<string>> }).from(weldJoints).where(where)
      for (const item of values) assert.equal(item.value, projected.find(row => row.id === item.id)!.pstoCycleSummary, `setting ${enabled}; joint ${rows.find(row => row.id === item.id)!.joint}`)
    }
  } finally {
    if (previous) await db.update(appSettings).set({ value: previous.value }).where(eq(appSettings.key, previous.key))
    else await db.delete(appSettings).where(eq(appSettings.key, PROJECT_SETTING_KEYS.controlProcesses))
  }
})

test('RK scheme boundaries compare diameters, retain duplicate-boundary options and parse CRLF literally', async () => {
  const table = { fileName: 'boundary fixture', uploadedAt: '', entries: [
    { diameter: 100, options: [{ label: 'Below', values: ['0', '120'], isDefault: true, note: '' }] },
    { diameter: 100, options: [{ label: 'At 100', values: ['0', '120'], isDefault: true, note: '' }] },
    { diameter: 200, options: [{ label: 'At 200', values: ['0', '120'], isDefault: true, note: '' }] },
  ] }
  const cases = [
    { d1: 99, d2: null, confirmed: 100, type: 'С17', expected: 'Below' },
    { d1: 100, d2: null, confirmed: 99, type: 'С17', expected: 'At 100' },
    { d1: 100, d2: null, confirmed: 200, type: 'С17', expected: 'Требуется проверить' },
    { d1: null, d2: null, confirmed: 100, type: 'С17', expected: 'Пользовательская схема' },
    { d1: 199.999, d2: null, confirmed: 100, type: 'С17', expected: 'At 100' },
    { d1: 200, d2: null, confirmed: 199.999, type: 'С17', expected: 'Требуется проверить' },
    { d1: 245, d2: 99, confirmed: 99, type: 'У19', expected: 'Below' },
    { d1: 200, d2: null, confirmed: null, type: 'С17', expected: 'At 200' },
  ]
  await withLineProgramFixture(async db => {
    for (const [index, item] of cases.entries()) await db.query(`insert into weld_joints
      (project_title,line,joint,connection_type,d1,d2,rk_exposure_confirmed_diameter,lnk_defect_description)
      values($1,'RK-BOUNDARY',$2,$3,$4,$5,$6,$7)`,
    [project, `BOUNDARY-${index}`, item.type, item.d1, item.d2, item.confirmed, '\ufeff0 : A: B\r\n : ignored\r\n 120 : ДНО\r\n'])
  })
  const values = await requireDb().select({ joint: weldJoints.joint,
    value: buildCalculatedReportValueSql('lnk', 'rkExposureScheme', { ...DEFAULT_OTHER_SETTINGS, rkExposureTable: table }) as ReturnType<typeof sql<string>>,
  }).from(weldJoints).where(sql`${weldJoints.projectTitle} = ${project} and ${weldJoints.line} = 'RK-BOUNDARY'`)
  for (const [index, item] of cases.entries()) expect(values.find(row => row.joint === `BOUNDARY-${index}`)?.value).toBe(item.expected)
})


test('all main-method fields and calculated families select the same IDs before pagination', async () => {
  const db = requireDb(), where = eq(weldJoints.projectTitle, project)
  const stored = await attachHeatTreatmentControlRelations(await db.select().from(weldJoints).where(where))
  for (const report of ['weldingJournal', 'lnk', 'heatTreatment'] as const) {
    let projected = buildServerReportRows(stored as unknown as WeldJoint[], report)
      .map(row => ({ ...row, rkExposureScheme: getRkExposureSchemeState(row, null).label }))
    if (report === 'heatTreatment') projected = projectPstoReportDisplayValues(projected, ['pstoCycleSummary', 'pstoResult', 'pstoRequest', 'tvmtResult', 'pstoDate'])
    const fields: WeldFieldKey[] = [
      ...LNK_METHODS.flatMap(method => [method.requestKey, method.requestDateKey, method.resultKey, method.conclusionKey, method.conclusionDateKey]),
      ...PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS, 'controlBasisSummary', 'rkExposureScheme',
      ...(report === 'heatTreatment' ? ['pstoCycleSummary', 'pstoResult', 'pstoRequest', 'tvmtResult', 'pstoDate'] as WeldFieldKey[] : []),
    ]
    for (const field of fields) {
      const values = [...new Set(projected.map(row => String(row[field] ?? '').trim()))]
      for (const value of values) {
        const filter = { [field]: '=' + value }
        const expected = filterWeldRowsByColumns(projected, filter).map(row => row.id).sort((a,b) => a-b)
        const selected = await db.select({ id: weldJoints.id }).from(weldJoints)
          .where(buildReportQueryWhere(report, { projectTitle: project, columnFilters: filter }, DEFAULT_OTHER_SETTINGS))
        assert.deepEqual(selected.map(row => row.id).sort((a,b) => a-b), expected, `${report}/${field}/${value}`)
      }
    }
  }
})

test('page, summary, facets and full output share selection and preserve factual cycle history', async () => {
  const db = requireDb(), where = eq(weldJoints.projectTitle, project)
  const stored = await attachHeatTreatmentControlRelations(await db.select().from(weldJoints).where(where))
  for (const report of ['lnk', 'heatTreatment'] as const) {
    const factual = buildServerReportRows(stored as unknown as WeldJoint[], report)
    const projected = report === 'heatTreatment' ? projectPstoReportDisplayValues(factual, ['pstoCycleSummary', 'tvmtResult']) : factual
    for (const columnFilters of [{ preRkResult: '=ремонт' }, { rkResult: 'годен', preRkRequest: 'R-' }, { controlBasisSummary: '=' }] as Record<string, string>[]) {
      const expected = filterWeldRowsByColumns(projected, columnFilters).map(row => row.id).sort((a,b) => a-b)
      const request = { projectTitle: project, columnFilters, includeTotals: false, sort: { fieldKey: 'id', direction: 'asc' } } as const
      const page = await listReportPage(report, normalizeWeldPageRequest(request))
      expect(page.rows.map(row => row.id)).toEqual(expected)
      expect(page.hasMore).toBe(false)
      const output = await listReportPage(report, normalizeWeldPageRequest({ ...request, pageSize: 'all' }))
      expect(output.rows.map(row => row.id)).toEqual(expected)
      const snapshot = await readReportOutputSnapshot({ report, sort: request.sort, fieldKeys: ['joint', 'pstoRequest', 'tvmtResult'],
        columnFilters: { projectTitle: `=${project}`, ...columnFilters } })
      expect((snapshot.report.tables?.[0]?.rows ?? []).map(row => row[0])).toEqual(expected.map(id => stored.find(row => row.id === id)!.joint))
      const totals = await getWeldReportSummary({ data: { ...request, report } })
      expect(totals.total).toBe(expected.length)
      const facets = await listColumnFilterOptions(normalizeWeldColumnFilterOptionsRequest({
        ...request, report, fieldKey: 'preRkResult', columnFilters: { ...columnFilters, preRkResult: '=own filter must be excluded' },
      }))
      const otherFilters = Object.fromEntries(Object.entries(columnFilters).filter(([key]) => key !== 'preRkResult'))
      expect(facets).toEqual(buildWeldColumnFilterOptionsFromRows(filterWeldRowsByColumns(projected, otherFilters), 'preRkResult'))
      if (report === 'heatTreatment') for (const row of page.rows) {
        const original = stored.find(original => original.id === row.id)!
        expect(row.pstoResult ?? null).toBe(original.pstoResult)
        expect(row.pstoRepeatCycles ?? []).toEqual(original.pstoRepeatCycles)
      }
    }
  }
})


test('PSTO retains a historical row whose only treatment facts are in a repeat', async () => {
  let id = 0
  await withLineProgramFixture(async db => {
    const inserted = await db.query(`insert into weld_joints(project_title,line,joint,weld_date,has_vik)
      values($1,'PARITY','HISTORY-ONLY','2026-06-01','да') returning id`, [project])
    id = inserted.rows[0].id
    await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_result,tvmt_request,tvmt_result)
      values($1,2,'HISTORICAL-PSTO','проведено','HISTORICAL-TVMT','годен')`, [id])
  })
  for (const filter of [{}, { pstoCycleSummary: 'Повтор #2' }] as Record<string,string>[]) {
    const page = await listReportPage('heatTreatment', normalizeWeldPageRequest({ projectTitle: project,
      columnFilters: { joint: '=HISTORY-ONLY', ...filter }, includeTotals: true,
    }))
    expect(page.total).toBe(1)
    expect(page.rows.map(row => row.id)).toEqual([id])
    expect(page.rows[0].pstoResult).toBeUndefined()
    expect(page.rows[0].pstoRepeatCycles?.[0].pstoResult).toBe('проведено')
    expect(page.rows[0].pstoCycleSummary).toBe('Повтор #2 · цикл завершен')
  }
})

test('WDI header sort uses current values across pages, filters and settings changes', async () => {
  const db = requireDb()
  const key = PROJECT_SETTING_KEYS.other
  const [previous] = await db.select().from(appSettings).where(eq(appSettings.key, key))
  try {
    // Stored manual values deliberately disagree with both calculated modes.
    await withLineProgramFixture(async client => {
      await client.query(`insert into weld_joints(project_title,line,joint,weld_date,has_vik,psto_required,connection_type,d1,t1,wdi)
        select $1,'SORT',case when n<=101 then 'A'||lpad(n::text,3,'0') else 'B'||(n-101)::text end,
          '2026-06-01','да','да','С17',case when n<=101 then 245 else 114 end,6,
          case when n<=101 then 1 else 99 end from generate_series(1,103) n`, [project])
    })
    expect(isDispatcherTaskIndexFresh(await ensureDispatcherTaskIndexFresh())).toBe(true)
    for (const mode of ['formula', 'table', 'manual'] as const) {
      const settings = { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: mode, wdiTable: {
        fileName: 'sort fixture', uploadedAt: '', diameters: [114, 245], thicknesses: [6], values: [[8], [2]],
      } }
      await db.insert(appSettings).values({ key, value: JSON.stringify(settings) })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(settings) } })
      // Deliberately no row/revision change: the page cache must distinguish
      // settings used by sorting even when the filter itself is settings-free.
      const a = Array.from({ length: 101 }, (_, i) => `A${String(i + 1).padStart(3, '0')}`)
      const b = ['B1', 'B2']
      for (const report of ['weldingJournal', 'lnk', 'heatTreatment'] as const) {
        for (const derived of [false, true]) for (const direction of ['asc', 'desc'] as const) {
          const expected = (mode === 'formula') === (direction === 'asc') ? [...b, ...a] : [...a, ...b]
          const request = { projectTitle: project, includeTotals: false, pageSize: 100,
            columnFilters: { line: '=SORT',
              ...(derived ? { controlBasisSummary: '=' } : {}) },
            sort: { fieldKey: 'wdi', direction },
          } as const
          const first = await listReportPage(report, normalizeWeldPageRequest(request))
          const second = await listReportPage(report, normalizeWeldPageRequest({ ...request, page: 2 }))
          expect([...first.rows, ...second.rows].map(row => row.joint), `${report}/${mode}/${derived}/${direction}`)
            .toEqual(expected)
          expect(first.rows).toHaveLength(100)
          expect(second.rows).toHaveLength(3)
          expect(first.hasMore).toBe(true)
          expect(second.hasMore).toBe(false)
          const output = await listReportPage(report, normalizeWeldPageRequest({ ...request, pageSize: 'all' }))
          expect(output.rows.map(row => row.joint)).toEqual(expected)
        }
      }
    }
  } finally {
    if (previous) await db.update(appSettings).set({ value: previous.value }).where(eq(appSettings.key, key))
    else await db.delete(appSettings).where(eq(appSettings.key, key))
  }
})

const getWeldReportSummary = asE2eOwner(raw_getWeldReportSummary, 'welding.view')
const readReportOutputSnapshot = asE2eOwner(raw_readReportOutputSnapshot, 'welding.view')
