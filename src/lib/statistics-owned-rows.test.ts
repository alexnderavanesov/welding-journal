import { expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { DEFAULT_OTHER_SETTINGS } from './other-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import { prepareStatisticsHeatTreatmentRows, prepareStatisticsHeatTreatmentRowsInPlace } from './statistics-psto-cycle'
import { prepareJournalPageRows, prepareJournalSummaryRowsInPlace, prepareReportRows, prepareReportRowsInPlace } from './use-report-rows'
import { buildStatisticsServerResult, type StatisticsTab } from './statistics-server-summary'
import { createWeldGroupSummarizer } from './weld-group-summary'
import { withSystemWdi } from './wdi'

const source = (): WeldRow[] => Array.from({ length: 24 }, (_, n) => ({
  id: n + 1, projectTitle: 'P', subtitleCode: 'S', line: 'L' + n % 3, joint: 'F' + (n + 1),
  weldDate: n % 5 ? '2026-10-01' : null, officiality: n % 7 ? 'действующий' : 'неофициальный',
  revisionActuality: n % 8 ? 'актуальная' : 'неактуальная',
  connectionType: n % 6 ? 'С17' : 'Т1', d1: 108, d2: 108, t1: 4, t2: 4, weldLength: 500,
  wdi: 0.42, stamp1KFact: 'AAAA', stamp1ZFact: n % 2 ? 'BBBB' : null,
  hasVik: 'да', vikResult: 'годен', hasRk: n % 4 ? 'да' : 'отменен',
  rkRequest: n % 3 ? 'NK' : null, rkResult: ['годен', 'ремонт', null, 'вырез'][n % 4],
  pstoRequired: ['да', 'нет', 'отменен'][n % 3], preHeatTreatmentRequired: n % 2 === 0,
  pstoRequest: 'PSTO', pstoResult: n % 4 ? 'проведено' : null, pstoDate: n % 4 ? '2026-10-02' : null,
  tvmtRequest: 'TVMT', tvmtResult: n % 2 ? 'годен' : 'не годен',
  finalStatus: 'годен',
}))
const cycles = [
  { id: 20, weldJointId: 2, sequence: 2, pstoRequest: 'repeat-waiting' },
  { id: 30, weldJointId: 3, sequence: 3, pstoRequest: 'performed', pstoDate: '2026-10-04', pstoResult: 'проведено', tvmtResult: 'не годен' },
  { id: 31, weldJointId: 3, sequence: 4, pstoRequest: 'unstarted-after-cancel' },
]
const controls = [
  { id: 9, weldJointId: 1, method: 'РК', result: 'ремонт' },
  { id: 4, weldJointId: 1, method: 'ВИК', result: 'годен' },
  { id: 3, weldJointId: 2, method: 'РК', requestName: 'PRE-NK' },
]
const duplicate = [{ id: 1, version: '1', weldJointId: 5, method: 'РК' as const, result: 'ремонт' as const,
  controlDate: '2026-10-03', conclusion: 'D', conclusionDate: '2026-10-03' }]

for (const preHeatTreatmentMode of ['selected', 'allPsto'] as const) {
  for (const unit of ['joints', 'wdi'] as const) it(`owned statistics keeps every tab/drilldown: ${preHeatTreatmentMode}, ${unit}`, () => {
    const settings = { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula' as const }
    const previous = prepareReportRows(prepareStatisticsHeatTreatmentRows(source(), cycles, controls, { preHeatTreatmentMode }), duplicate,
      undefined, undefined, settings)
    const owned = source(), first = owned[0]
    const next = prepareReportRowsInPlace(prepareStatisticsHeatTreatmentRowsInPlace(owned, cycles, controls, { preHeatTreatmentMode }), duplicate)
    for (const row of next) Object.assign(row, withSystemWdi(row, settings))
    expect(next[0]).toBe(first)
    expect(next[0].preHeatTreatmentControls).toEqual(previous[0].preHeatTreatmentControls)
    const controlsByTab: unknown[] = []
    for (const tab of ['general', 'lnk', 'psto', 'supports', 'welders', 'lineSummary'] as StatisticsTab[]) {
      const build = (rows: WeldRow[]) => buildStatisticsServerResult({ rows, welderStamps: [], systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
        request: { tab, from: '2026-10-01', to: '2026-10-31', unit } })
      expect(build(next), tab).toEqual(build(previous))
      if (tab === 'lnk' || tab === 'psto') controlsByTab.push(build(next))
    }
    expect(controlsByTab[0]).toEqual(controlsByTab[1])
  })
}

it.each(['lnk', 'heatTreatment'] as const)('owned %s grouping preserves stage values and physical summaries', report => {
  const initial = prepareStatisticsHeatTreatmentRows(source(), cycles, controls, { preHeatTreatmentMode: 'selected' })
  const before = prepareJournalPageRows(structuredClone(initial), report)
  const owned = structuredClone(initial), first = owned[0]
  const after = prepareJournalSummaryRowsInPlace(owned, report)
  expect(after[0]).toBe(first)
  const summarize = (rows: WeldRow[]) => {
    const { rows: _rows, ...result } = createWeldGroupSummarizer(rows, DEFAULT_SYSTEM_INDEX_SETTINGS,
      { lnk: report === 'lnk', heatTreatment: report === 'heatTreatment' })(rows)
    return result
  }
  expect(summarize(after)).toEqual(summarize(before))
  expect(after.map(row => row.pstoResult)).toEqual(before.map(row => row.pstoResult))
})
