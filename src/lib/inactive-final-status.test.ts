import { expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { calculateFinalStatusInRows, FINAL_STATUS_OPTIONS, normalizeFinalStatus } from './weld-status'
import { prepareReportRows } from './use-report-rows'
import { buildStatisticsStateRowIds, buildStatisticsSummary } from './statistics-summary'
import { buildWelderStatisticsSummary } from './welder-statistics-summary'
import { buildSupportStatistics } from './support-statistics'
import { buildWeldingJournalWaitingRepairRows } from './welding-journal-report-rows'

const base: WeldRow = { id: 1, joint: 'F1', weldDate: '2026-11-01', hasVik: 'да', wdi: '2', stamp1KFact: 'AA', stamp1ZFact: 'AA', }

it.each<[string, Partial<WeldRow>, string]>([
  ['request', {}, 'ожидает заявку'],
  ['control', { vikRequest: 'V1', vikResult: 'ожидает НК' }, 'ожидает НК'],
  ['weld', { weldDate: '' }, 'ожидает сварку'],
  ['repair', { joint: 'F1R1', weldDate: '' }, 'ожидает ремонт'],
  ['partial results', { vikResult: 'годен', hasRk: 'да' }, 'ожидает заявку'],
  ['pre-TO', { preHeatTreatmentRequired: true, pstoRequired: 'да', vikResult: 'годен' }, 'ожидает заявку до ТО'],
  ['PSTO', { preHeatTreatmentRequired: true, hasVik: '', pstoRequired: 'да' }, 'ожидает заявку'],
  ['TVMT', { preHeatTreatmentRequired: true, hasVik: '', pstoRequired: 'да', pstoResult: 'проведено', pstoDate: '2026-11-02' }, 'ожидает заявку'],
])('replaces %s waiting with inactivity and restores the current calculation on reactivation', (_name, fields, waiting) => {
  const active = { ...base, ...fields }
  const inactive = { ...active, revisionActuality: 'не актуален', finalStatus: waiting }
  expect(calculateFinalStatusInRows(active, [active])).toBe(waiting)
  expect(calculateFinalStatusInRows(inactive, [inactive])).toBe('неактуальный')
  expect(prepareReportRows([inactive])[0].finalStatus).toBe('неактуальный')
  expect(calculateFinalStatusInRows({ ...inactive, revisionActuality: null }, [inactive])).toBe(waiting)
})

it.each<[Partial<WeldRow>, string]>([
  [{ vikResult: 'годен' }, 'годен'],
  [{ vikResult: 'ремонт' }, 'не годен'],
  [{ vikResult: 'годен', duplicateControls: [{ id: 1, weldJointId: 1, method: 'РК', result: 'вырез', controlDate: '2026-11-02', conclusion: 'D1', conclusionDate: '2026-11-02' }] }, 'не годен по дублю'],
  [{ hasVik: '', vikResult: 'годен' }, 'ошибка'],
])('preserves a completed result or data error: %s', (fields, result) => {
  const row = { ...base, ...fields, revisionActuality: 'не актуален' }
  expect(calculateFinalStatusInRows(row, [row])).toBe(result)
})

it('recognizes the new final status in shared filter/export vocabulary', () => {
  expect(FINAL_STATUS_OPTIONS).toContain('неактуальный')
  expect(normalizeFinalStatus(' НЕАКТУАЛЬНЫЙ ')).toBe('неактуальный')
})

it('does not revive a stale waiting-repair status in the repair report', () => {
  const source = { ...base, vikResult: 'ремонт', revisionActuality: 'не актуален' }
  const repair = { ...base, id: 2, joint: 'F1R1', weldDate: '', revisionActuality: 'не актуален', finalStatus: 'ожидает ремонт' }
  expect(buildWeldingJournalWaitingRepairRows([source, repair])).toEqual([])
})

it.each(['joints', 'wdi'] as const)('excludes inactive pending work from statistics and drilldowns, retaining historical results (%s)', unit => {
  const inactive = { preHeatTreatmentRequired: true, ...base, revisionActuality: 'не актуален', hasRk: 'да', hasUzk: 'да', hasPvk: 'да', pstoRequired: 'да' }
  const rows: WeldRow[] = [
    inactive,
    { ...inactive, id: 2, vikRequest: 'V2', vikRequestDate: '2026-11-02', pstoRequest: 'P2', pstoRequestDate: '2026-11-02' },
    { preHeatTreatmentRequired: true, ...base, id: 3, revisionActuality: 'не актуален', hasVik: '', pstoRequired: 'да', pstoRequest: 'P3', pstoRequestDate: '2026-11-02', pstoResult: 'проведено', pstoDate: '2026-11-03', tvmtRequest: 'T3', tvmtRequestDate: '2026-11-03' },
    { ...base, id: 4, revisionActuality: 'не актуален', vikRequest: 'V4', vikRequestDate: '2026-11-02', vikResult: 'годен', vikConclusionDate: '2026-11-03' },
    { ...base, id: 5, revisionActuality: 'не актуален', vikRequest: 'V5', vikRequestDate: '2026-11-02', vikResult: 'ремонт', vikConclusionDate: '2026-11-03' },
    { ...base, id: 6 },
  ]
  const weight = unit === 'joints' ? 1 : 2
  const summary = buildStatisticsSummary(rows, '', '', unit)
  expect(summary).toMatchObject({ waitingRequest: weight, waitingControl: 0, good: weight, rejected: weight })
  expect(buildStatisticsStateRowIds(rows, '', '', unit)).toMatchObject({ waitingRequest: [6], waitingControl: [], good: [4], rejected: [5] })
  for (const method of summary.methods) {
    expect(method.waitingRequest).toBe(method.code === 'ВИК' ? weight : 0)
    expect(method.waitingControl).toBe(0)
    expect(method.rowIds.requiredRequests).not.toContain(1)
    expect(method.rowIds.requiredRequests).not.toContain(2)
  }
  expect(summary.methods.find(method => method.code === 'ВИК')).toMatchObject({ good: weight, rejected: weight })
  expect(summary.pstoMethod).toMatchObject({ waitingRequest: 0, waitingControl: 0, totalClosed: weight })
  expect(summary.pstoMethod.rowIds.requiredRequests).toEqual([3])
  expect(summary.tvmtMethod).toMatchObject({ requiredRequests: 0, waitingRequest: 0, waitingControl: 0 })
  const welders = buildWelderStatisticsSummary(rows, [], '', '', unit)
  expect(welders.rows[0]).toMatchObject({ waitingRequest: weight, waitingControl: 0, good: weight, rejected: weight })
  const supports = buildSupportStatistics(rows.map(row => ({ ...row, connectionType: 'Т1' })), '', '')
  expect(supports.welders?.[0]).toMatchObject({ waitingRequest: 1, waitingControl: 0, good: 1, rejected: 1 })
})
