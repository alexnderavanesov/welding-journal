import { expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { buildStatisticsServerResult, type StatisticsTab } from './statistics-server-summary'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import { captureProgramChainStates } from './line-program-chain-state'
import { formatGeneralStatisticValue } from './statistics-summary'

const row = (id: number, joint: string, date: string, result = 'годен', extra: Partial<WeldRow> = {}): WeldRow => ({
  id, joint, weldDate: date, projectTitle: 'Проект', subtitleCode: 'Шифр', line: 'Линия',
  connectionType: 'С17', hasVik: 'да', vikResult: result, wdi: 8.05, ...extra,
})
const calculate = (rows: WeldRow[], from = '2026-10-01', to = '2026-10-31', tab: StatisticsTab = 'general', unit: 'joints' | 'wdi' = 'wdi') =>
  buildStatisticsServerResult({ rows, welderStamps: [], systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
    request: { tab, from, to, unit } })

it('credits a repaired connection only in the month of its current weld, including waiting control', () => {
  const rows = [row(1, 'S1', '2026-09-01', 'ремонт'), row(2, 'S1R1', '2026-10-02', '')]
  const october = calculate(rows)
  expect(october.summary).toMatchObject({ welded: 8.05, rejected: 0, rejectedJointCount: 0 })
  expect(october.weldingDynamics.totalValue).toBe(8.05)
  expect(october.generalStateRowIds.waitingRequest).toEqual([2])
  expect(calculate(rows, '2026-09-01', '2026-09-30').summary.welded).toBe(0)
  expect(calculate(rows, '', '').summary.welded).toBe(8.05)
  rows[1].vikResult = 'годен'
  expect(calculate(rows).summary.good).toBe(8.05)
  rows[1].vikResult = 'вырез'
  const rejected = calculate(rows)
  expect(rejected.summary).toMatchObject({ welded: 0, rejected: 8.05, rejectedJointCount: 1, qualityPercent: 0 })
  expect(rejected.weldingDynamics.totalValue).toBe(0)
  expect(rejected.generalStateRowIds.rejected).toEqual([2])
  expect(rejected.generalProgressSummary).toMatchObject({ total: 8.05, completed: 0, remaining: 8.05 })
})

it('agrees across projects, cards, dynamics, units and rejection counts without WDI', () => {
  const rows = [row(1, 'S1', '2026-10-01', 'годен', { projectTitle: 'А', wdi: 2140.05 }),
    row(2, 'S2', '2026-10-02', 'годен', { projectTitle: 'Б', wdi: 3796.7 }),
    row(3, 'S3', '2026-10-03', 'ремонт'), row(4, 'S4', '2026-10-04', 'вырез', { wdi: '' })]
  const result = calculate(rows)
  expect(result.summary.welded).toBeCloseTo(5936.75, 8)
  expect(result.summary.rejectedJointCount).toBe(2)
  expect(result.weldingDynamics.totalValue).toBeCloseTo(5936.75, 8)
  expect(result.weldingDynamics.projectGroups.map(group => group.value).sort((a,b) => a-b)).toEqual([2140.05, 3796.7])
  expect(formatGeneralStatisticValue(result.summary.welded, 'wdi').replace(/\s/g, '')).toBe('5936,75')
  expect(calculate(rows, undefined, undefined, 'general', 'joints').summary).toMatchObject({ welded: 2, rejected: 2 })
  // Existing event/statistics tabs intentionally retain record-by-record work.
  for (const tab of ['lnk', 'psto'] as const) expect(calculate(rows, undefined, undefined, tab).summary.welded).toBeCloseTo(5944.8, 8)
  expect(calculate(rows, undefined, undefined, 'lineSummary').lineSummary.completed).toBeCloseTo(5944.8, 8)
})

it('keeps stable identities, two surviving coil sides and rejected duplicate control', () => {
  const input = [row(1, 'S1', '2026-09-01', 'вырез'), row(2, 'S1W1', '2026-10-01'),
    row(3, 'S2', '2026-09-01', 'вырез'), row(4, 'S2Y1', '2026-10-01', 'ремонт'),
    row(5, 'S2Y2', '2026-10-01'), row(6, 'S2Y1R1', '2026-10-02')]
  const states = captureProgramChainStates(input)
  const rows = input.map(row => ({ ...row, programChainState: states.get(row.id)! }))
  rows[5].joint = 'S900'
  expect(calculate(rows, '', '', 'general', 'joints').summary.welded).toBe(3)
  rows[1].duplicateControls = [{ id: 1, weldJointId: 2, method: 'ВИК', result: 'ремонт' }] as WeldRow['duplicateControls']
  expect(calculate(rows, '', '', 'general', 'joints').summary).toMatchObject({ welded: 2, rejected: 1 })
  rows[5].weldDate = ''
  expect(calculate(rows, '', '', 'general', 'joints').summary.welded).toBe(1)
})

it('preserves an unofficial predecessor for pending same-name repair classification', () => {
  const result = calculate([row(1, 'S1', '2026-09-01', 'вырез', { officiality: 'неофициальный' }), row(2, 'S1', '', '')], '', '', 'general', 'joints')
  expect(result.summary).toMatchObject({ welded: 0, backlogWaitingRepair: 1 })
  expect(result.generalStateRowIds.backlogWaitingRepair).toEqual([2])
})
