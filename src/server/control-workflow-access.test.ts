import { expect, it } from 'vitest'
import type { AccessIdentity, Permission } from '@/lib/access-permissions'
import type { WeldRow } from '@/lib/dispatcher-types'
import { redactOperationResult } from './access-response'
import { hasWeldDate } from '@/lib/report-value-utils'
import { getPrimaryLnkStageAccess, getPrimaryPstoStartBlockReason, requiresPreHeatTreatmentLnk } from '@/lib/lnk-control-stage'
import { canCreateLnkRequest } from '@/lib/report-control-state'
import { canCreatePstoWorkflowRequest, canAddPstoWorkflowResult } from '@/lib/psto-status'
import { canCreateTvmtRequest, canAddTvmtResult } from '@/lib/tvmt-field-updates'
import { canCreatePreHeatTreatmentRequest } from '@/lib/pre-heat-treatment-control-updates'
import { assertReadableQuery, getOperationSearchArea, assertImportedWeldFields, assertSubmittedWeldFields } from './access-payload'
import { getHistoricalLnkRequestDateReason, getNewHistoricalLnkResultIssues } from '@/lib/lnk-system-order'
import { prepareReportRows } from '@/lib/use-report-rows'
import { compactWeldRowsForTransport } from './weld-request-utils'
import { analyzeLnkRequestExtensionTargets } from '@/lib/lnk-request-extension'

const identity = (...permissions: Permission[]): AccessIdentity => ({ id: 'limited', name: '', email: '', title: '', role: 'user', revision: 1, permissions })
const row: WeldRow = { preHeatTreatmentMode: 'selected', id: 1, rowVersion: '123', joint: 'F1', weldDate: '2026-10-01', hasVik: 'да', pstoRequired: 'да', preHeatTreatmentRequired: true, preHeatTreatmentControls: [], pstoRepeatCycles: [], weldingJournalNote: 'private welding', pstoNote: 'private psto', lnkNote: 'private lnk' }
const goodPre = [{ id: 1, weldJointId: 1, method: 'ВИК', requestName: 'pre', requestDate: '2026-10-02', result: 'годен', conclusionName: 'pre good', conclusionDate: '2026-10-03' }]
const project = (source: WeldRow, area: 'lnk' | 'psto') => redactOperationResult(identity(`${area}.view`), 'weld-read-api.ts', area === 'lnk' ? 'listLnkWorkflowRows' : 'listPstoWorkflowRows', source)

it('never accepts workflow readiness from a form, import or replacement client', () => {
  const forged = { id: 1, controlWorkflowAccess: { welded: true, heatTreatmentState: 'complete' } }
  expect(() => assertSubmittedWeldFields(forged, row, 'lnk')).toThrow('недоступно для изменения')
  expect(() => assertImportedWeldFields(forged)).toThrow('недоступно для изменения')
  expect(() => assertImportedWeldFields(forged, row)).toThrow('недоступно для изменения')
})

it('keeps a welded NK candidate without exposing the weld date or other specialty facts', () => {
  const result = project({ preHeatTreatmentRequired: true, ...row, pstoRequired: 'нет' }, 'lnk')
  expect(result).not.toHaveProperty('weldDate')
  expect(result).not.toHaveProperty('weldingJournalNote')
  expect(result).not.toHaveProperty('pstoNote')
  expect(hasWeldDate(result)).toBe(true)
  expect(canCreateLnkRequest(result)).toBe(true)
  expect(hasWeldDate(project({ ...row, weldDate: null }, 'lnk'))).toBe(false)
  expect(requiresPreHeatTreatmentLnk(result)).toBe(false)
  expect(canCreatePreHeatTreatmentRequest(project(row, 'lnk'), 'ВИК')).toBe(true)
  expect(prepareReportRows([result])[0]).not.toHaveProperty('finalStatus')
})

it.each([
  ['waiting-psto-request', {}, 'allowed-with-warning'],
  ['waiting-psto', { pstoRequest: 'private request' }, 'allowed-with-warning'],
  ['waiting-tvmt-request', { pstoRequest: 'private request', pstoResult: 'проведено' }, 'allowed-with-warning'],
  ['waiting-tvmt', { pstoRequest: 'private request', pstoResult: 'проведено', tvmtRequest: 'private tvmt' }, 'allowed-with-warning'],
  ['repeat-psto-required', { pstoRequest: 'private request', pstoResult: 'проведено', tvmtRequest: 'private tvmt', tvmtResult: 'не годен' }, 'allowed-with-warning'],
  ['complete', { pstoRequest: 'private request', pstoResult: 'проведено', tvmtRequest: 'private tvmt', tvmtResult: 'годен' }, 'ready'],
] as const)('NK uses %s readiness without exposing PSTO documents', (_state, facts, expected) => {
  const result = project({ ...row, ...facts, preHeatTreatmentControls: goodPre }, 'lnk')
  expect(result).not.toHaveProperty('pstoRequest')
  expect(result).not.toHaveProperty('tvmtRequest')
  expect(getPrimaryLnkStageAccess(result, 'ВИК').status).toBe(expected)
  expect(getPrimaryLnkStageAccess(result, 'ВИК', { preHeatTreatmentMode: 'selected',  }).status).toBe(expected === 'ready' ? 'ready' : 'allowed-with-warning')
})

it('NK uses the current repeat; restricted PSTO retains primary facts after cancellation', () => {
  const source: WeldRow = { ...row, preHeatTreatmentControls: goodPre, pstoRequest: 'primary', pstoResult: 'проведено', tvmtRequest: 'primary TVMT', tvmtResult: 'не годен',
    pstoRepeatCycles: [{ id: 1, weldJointId: 1, sequence: 2, pstoRequest: 'repeat', pstoResult: 'проведено', tvmtRequest: 'repeat TVMT', tvmtResult: 'не годен' }] }
  expect(getPrimaryLnkStageAccess(project(source, 'lnk'), 'ВИК').status).toBe('allowed-with-warning')
  const completed = { ...source, pstoRepeatCycles: [{ ...source.pstoRepeatCycles![0], tvmtResult: 'годен' }] }
  expect(getPrimaryLnkStageAccess(project(completed, 'lnk'), 'ВИК').status).toBe('ready')
  const cancelled = project({ preHeatTreatmentRequired: true, ...completed, pstoRequired: 'отменен' }, 'psto')
  const report = prepareReportRows([cancelled], [], undefined, undefined, undefined, false, true)[0]
  expect(report.pstoResult).toBe('проведено')
  expect(report).not.toHaveProperty('finalStatus')
})

it('PSTO prerequisites preserve missing, rejected and completed NK states without its documents', () => {
  const missing = project(row, 'psto')
  expect(getPrimaryPstoStartBlockReason(missing)).toContain('Сначала создайте заявки НК до ТО: ВИК')
  expect(canCreatePstoWorkflowRequest(missing)).toBe(false)
  const good = project({ ...row, preHeatTreatmentControls: goodPre }, 'psto')
  expect(canCreatePstoWorkflowRequest(good)).toBe(true)
  for (const result of [missing, good]) {
    expect(result).not.toHaveProperty('preHeatTreatmentControls')
    expect(result).not.toHaveProperty('hasVik')
    expect(result).not.toHaveProperty('lnkNote')
  }
  const failed = project({ ...row, preHeatTreatmentControls: [{ ...goodPre[0], result: 'ремонт' }], pstoRequest: 'p', pstoResult: 'проведено', tvmtRequest: 't' }, 'psto')
  expect(getPrimaryPstoStartBlockReason(failed)).toContain('негодный результат: ВИК')
  expect(canCreatePstoWorkflowRequest(failed)).toBe(false)
  expect(canAddPstoWorkflowResult(failed)).toBe(false)
  expect(canCreateTvmtRequest(failed)).toBe(false)
  expect(canAddTvmtResult(failed)).toBe(false)
  expect(canCreatePstoWorkflowRequest(project({ ...row, preHeatTreatmentRequired: false }, 'psto'))).toBe(true)
})

it('compact null fields and restored old workflow metadata cannot invent readiness', () => {
  const compact = { ...row, weldDate: undefined, nullFields: ['weldDate'], controlWorkflowAccess: { welded: true } }
  expect(hasWeldDate(project(compact, 'lnk'))).toBe(false)
  expect(redactOperationResult(identity('lines.view'), 'line-program.ts', 'getLineProgramJointPage', row)).not.toHaveProperty('controlWorkflowAccess')
  const { preHeatTreatmentControls: _pre, pstoRepeatCycles: _cycles, preHeatTreatmentMode: _policy, ...returningRow } = row
  expect(project(returningRow, 'lnk')).not.toHaveProperty('controlWorkflowAccess')
  const compacted = compactWeldRowsForTransport([{ preHeatTreatmentRequired: true, ...row, pstoRequired: null, weldDate: null }])[0]
  expect(hasWeldDate(project(compacted, 'lnk'))).toBe(false)
  expect(requiresPreHeatTreatmentLnk(project(compacted, 'lnk'))).toBe(false)
  const rkOnly = compactWeldRowsForTransport([{ ...row, hasVik: null, hasRk: 'да' }])[0]
  expect(getPrimaryPstoStartBlockReason(project(rkOnly, 'psto'))).toContain('НК до ТО: РК')
  const historical = compactWeldRowsForTransport([{ preHeatTreatmentRequired: true, ...row, pstoRequired: null, pstoRequest: 'p', pstoResult: 'проведено', pstoDate: '2026-10-04', heatTreatmentDiagram: 'd' }])[0]
  expect(requiresPreHeatTreatmentLnk(project(historical, 'lnk'))).toBe(false)
})

it('historical NK backfill defers only hidden weld-date comparison to authoritative server validation', () => {
  const source: WeldRow = { preHeatTreatmentRequired: true, ...row, pstoRequired: 'нет', hasRk: 'да', vikRequest: 'v', vikRequestDate: '2026-10-02', rkResult: 'ремонт', rkConclusionDate: '2026-10-05' }
  const visible = project(source, 'lnk')
  expect(getHistoricalLnkRequestDateReason(visible, 'ВИК', '2026-10-02')).toBe('')
  expect(getNewHistoricalLnkResultIssues([{ ...visible, vikResult: 'годен', vikConclusionDate: '2026-10-03' }], [visible])).toEqual([])
  expect(getHistoricalLnkRequestDateReason(source, 'ВИК', '2026-09-01')).toContain('раньше даты сварки')
})

it('extending an NK request accepts hidden welding facts but the server still rejects missing or later welding', () => {
  const source = { preHeatTreatmentRequired: true, ...row, pstoRequired: 'нет' }
  const analyze = (value: WeldRow) => analyzeLnkRequestExtensionTargets({ rows: [value], methodKeys: ['vikRequest'], requestName: 'existing', requestDate: '2026-10-02' })
  expect(analyze(project(source, 'lnk'))).toEqual({ targets: [{ rowId: 1, methodKey: 'vikRequest' }], issues: [] })
  expect(analyze(project({ ...source, weldDate: null }, 'lnk')).issues[0].reason).toContain('дата сварки')
  expect(analyze({ ...source, weldDate: '2026-10-03' }).issues[0].reason).toContain('дата сварки позднее')
})

it.each(['lnk', 'psto'] as const)('%s scoped search needs only its own view; foreign selectors and global search remain forbidden', area => {
  const account = identity(`${area}.view`)
  const operation = area === 'lnk' ? 'listLnkWorkflowRows' : 'listPstoWorkflowRows'
  const scope = getOperationSearchArea('src/server/weld-read-api.ts', operation)
  expect(scope).toBe(area)
  expect(() => assertReadableQuery(account, { search: 'L1' }, scope)).not.toThrow()
  expect(() => assertReadableQuery(account, { search: 'L1' })).toThrow('Общий поиск')
  expect(() => assertReadableQuery(account, { search: 'L1', columnFilters: { weldingJournalNote: 'private' } }, scope)).toThrow('недоступное поле')
  expect(getOperationSearchArea('other.ts', operation)).toBeUndefined()
  expect(getOperationSearchArea('weld-read-api.ts', 'getReportRows')).toBeUndefined()
})
