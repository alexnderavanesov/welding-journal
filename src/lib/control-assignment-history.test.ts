import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { getControlAssignmentRemovalReason, getControlAssignmentCancellations } from './control-assignment-history'
import { getProgramAssignmentError } from './line-program-assignment-validation'
import { getWeldFormSaveBlockReason } from './weld-form-save-reasons'
import { DEFAULT_SAVE_CHECK_SETTINGS } from './save-check-settings'
import { calculateFinalStatus } from './weld-status'
import { getCancelledLnkResultDisplay, getCancelledPstoResultDisplay } from './report-value-utils'
import { buildPstoCancelledRow } from './psto-line-assignment'
import { buildPstoCycleTimeline } from './psto-cycle'
import { getCurrentPstoCycle, getPstoTvmtWorkflowState } from './tvmt-cycle'
import { buildRepeatedJointTasks } from './repeated-joint-tasks'
import { buildDispatcherTaskIndexRows, buildMergedDispatcherTaskCodes } from './dispatcher-task-row-codes'
import { prepareReportRows, prepareReportRowsInPlace } from './use-report-rows'
import { hasRejectedLnkResult, getAvailableLnkRequestMethods } from './lnk-status'
import { restoreActiveLnkCancelledResults } from './lnk-field-updates'
import { restoreActivePstoCancelledResult } from './psto-field-updates'

const base: WeldRow = { id: 1, joint: 'F1', connectionType: 'С17', hasRk: 'да', hasUzk: 'да', hasPvk: 'да' }
const pre = { id: 1, weldJointId: 1, method: 'РК' }
const cycle = { id: 1, weldJointId: 1, sequence: 2 }
describe('assignment removal and cancellation are distinct operations', () => {
  it.each(['primary', 'preheat', 'duplicate'])('keeps a rejected %s control in dispatcher and persisted row filters after cancellation', stage => {
    const row: WeldRow = { ...base, projectTitle: 'P', subtitleCode: 'S', line: 'L', weldDate: '2026-09-01', hasRk: 'отменен',
      ...(stage === 'primary' ? { rkResult: 'ремонт', rkConclusion: 'ЗНК' } :
        stage === 'preheat' ? { pstoRequired: 'отменен', preHeatTreatmentControls: [{ ...pre, result: 'ремонт', conclusionName: 'ЗНК' }] } :
        { duplicateControls: [{ ...pre, method: 'РК', result: 'ремонт', conclusion: 'ЗНК', conclusionDate: '2026-09-02', controlDate: '2026-09-02' }] }),
    }
    const tasks = buildRepeatedJointTasks([row]).filter(task => task.kind === 'create')
    expect(tasks).toEqual(expect.arrayContaining([expect.objectContaining({ sourceJoint: 'F1', targetJoint: 'F1R1' })]))
    const persisted = buildDispatcherTaskIndexRows(tasks, [row])
    expect(persisted.length).toBeGreaterThan(0)
    expect(buildMergedDispatcherTaskCodes(persisted, []).allByRowId.get(row.id)).toBeTruthy()
  })
  it.each([
    { rkRequest: 'РК-1', rkResult: 'ожидает НК' },
    { rkResult: 'годен', rkConclusion: 'ЗНК-1' },
    { preHeatTreatmentLnkEnabled: false, preHeatTreatmentControls: [{ ...pre, requestName: 'ДО-1' }] },
    { preHeatTreatmentControls: [{ ...pre, result: 'вырез', conclusionName: 'ДО-ЗНК' }] },
    { duplicateControls: [{ ...pre, method: 'РК' as const, result: 'ремонт' as const, conclusion: 'ДУБЛЬ-1', conclusionDate: '2026-09-01', controlDate: '2026-09-01' }] },
  ])('protects only the corresponding method across UI, stages and settings: %o', history => {
    const row: WeldRow = { ...base, ...history }
    const next = { ...row, hasRk: null }
    expect(getControlAssignmentRemovalReason(next, row)).toContain('нельзя снять')
    expect(getProgramAssignmentError(row, { РК: '' }, false)).toContain('нельзя снять')
    expect(getWeldFormSaveBlockReason(next, row, { ...DEFAULT_SAVE_CHECK_SETTINGS, controlHistoryProtection: false })).toContain('нельзя снять')
    expect(getProgramAssignmentError(row, { УЗК: '' })).toBe('')
    expect(getProgramAssignmentError(row, { РК: 'отменен' })).toBe('')
    expect(getControlAssignmentCancellations({ ...row, hasRk: 'отменен' }, row)).toEqual(['РК'])
    expect(getControlAssignmentCancellations(row, row)).toEqual([])
    expect(getControlAssignmentRemovalReason({ ...row, responsible: 'Иванов' }, row)).toBe('')
  })
  it.each(['ожидает заявку', 'ожидает НК', 'ожидает', null])('does not treat a %s label alone as history', rkResult => {
    expect(getProgramAssignmentError({ ...base, rkResult }, { РК: '' })).toBe('')
  })
  it.each([
    { pstoRequest: 'ПСТО-1' },
    { pstoResult: 'проведено', heatTreatmentDiagram: 'ДИАГРАММА' },
    { tvmtRequest: 'ТВМТ-1' },
    { tvmtResult: 'не годен', tvmtConclusion: 'ТВМТ-ЗНК' },
    { pstoRepeatCycles: [{ ...cycle, pstoRequest: 'ПОВТОР-2' }] },
    { pstoRepeatCycles: [{ ...cycle, tvmtRequest: 'ТВМТ-2' }] },
    { preHeatTreatmentControls: [{ ...pre, requestName: 'ДО-1' }] },
  ])('protects PSTO assignment across all its stages: %o', history => {
    const row: WeldRow = { ...base, pstoRequired: 'да', ...history }
    expect(getControlAssignmentRemovalReason({ ...row, pstoRequired: null }, row)).toContain('ПСТО')
    expect(getControlAssignmentRemovalReason({ ...row, pstoRequired: 'отменен' }, row)).toBe('')
  })
  it('protects TVMT history in a repeat without blocking an unrelated RK assignment', () => {
    const row = { ...base, hasTvmt: 'да', pstoRepeatCycles: [{ ...cycle, tvmtRequest: 'ТВМТ-2' }] }
    expect(getControlAssignmentRemovalReason({ ...row, hasTvmt: null }, row)).toContain('ТВМТ')
    expect(getProgramAssignmentError(row, { РК: '' })).toBe('')
  })
  it.each(['годен', 'ремонт', 'вырез'])('preserves the factual %s meaning after cancellation', result => {
    expect(getCancelledLnkResultDisplay(result)).toBe(`${result} · назначение отменено`)
    expect(getCancelledLnkResultDisplay(getCancelledLnkResultDisplay(result))).toBe(`${result} · назначение отменено`)
    const row = { ...base, weldDate: '2026-09-01', hasVik: 'да', vikResult: 'годен', hasRk: 'отменен', rkRequest: 'РК-1', rkResult: result, rkConclusion: 'РК-ЗНК', hasUzk: null, hasPvk: null }
    expect(calculateFinalStatus(row)).toBe(result === 'годен' ? 'годен' : 'не годен')
    expect(prepareReportRows(prepareReportRows([row]))[0].finalStatus).toBe(calculateFinalStatus(row))
    const report = prepareReportRows([row])[0]
    expect(hasRejectedLnkResult(report)).toBe(result !== 'годен')
    // Latest clarification permits an historical UZK request after own RK rejection.
    if (result !== 'годен') expect(getAvailableLnkRequestMethods({ ...report, hasUzk: 'да' }).map(method => method.code)).toEqual(['УЗК'])
    expect(restoreActiveLnkCancelledResults({ ...report, hasRk: 'да' }).rkResult).toBe(result)
  })
  it('keeps cancelled PSTO factual after report preparation and dispatcher recalculation', () => {
    const row: WeldRow = { id: 1, joint: 'F1', hasVik: 'да', weldDate: '2026-08-01',
      pstoRequired: 'отменен', pstoRequest: 'ПСТО', pstoResult: 'проведено', tvmtRequest: 'ТВМТ', tvmtResult: 'не годен',
      preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ВИК', requestName: 'ВИК до ТО', result: 'годен' }],
      pstoRepeatCycles: [{ id: 2, weldJointId: 1, sequence: 2, pstoRequest: 'Повтор' }],
    }
    const report = prepareReportRows([row])
    expect(report[0].pstoResult).toBe('проведено · назначение отменено')
    expect(report[0].finalStatus).toBe('ожидает заявку') // primary VIK still needs its request; not a new PSTO cycle
    expect(prepareReportRows(report)[0]).toMatchObject({ pstoResult: report[0].pstoResult, finalStatus: report[0].finalStatus })
    expect(prepareReportRowsInPlace([structuredClone(row)])[0].finalStatus).toBe(report[0].finalStatus)
    expect(restoreActivePstoCancelledResult({ ...report[0], pstoRequired: 'да' }).pstoResult).toBe('проведено')
  })
  it('uses cancelled, not waiting (cancelled), when there is no result', () => {
    expect(getCancelledLnkResultDisplay('ожидает НК')).toBe('отменен')
    expect(getCancelledPstoResultDisplay('ожидает заявку')).toBe('отменен')
  })
  it('retains all PSTO cycles and preheat documents on their original stages; unstarted cancelled repeat is not new demand', () => {
    const row: WeldRow = { ...base, pstoRequired: 'да', pstoRequest: 'ПСТО-1', pstoResult: 'проведено', heatTreatmentDiagram: 'ДИАГРАММА-1', tvmtRequest: 'ТВМТ-1', tvmtResult: 'не годен', tvmtConclusion: 'ТВМТ-ЗНК',
      preHeatTreatmentControls: [{ ...pre, requestName: 'ДО-1', result: 'годен', conclusionName: 'ДО-ЗНК' }], pstoRepeatCycles: [{ ...cycle, pstoRequest: 'ПОВТОР-2', pstoResult: 'ожидает' }] }
    const next = buildPstoCancelledRow({ row, cancellationDate: '2026-09-28', cancellationBasis: 'Решение' })
    expect(next).toEqual({ ...row, pstoRequired: 'отменен', pstoCancellationDate: '2026-09-28', pstoControlBasis: 'Решение' })
    expect(buildPstoCycleTimeline(next, next.pstoRepeatCycles)).toHaveLength(2)
    expect(getCurrentPstoCycle(next)?.sequence).toBe(1)
    expect(getPstoTvmtWorkflowState(next)).toBe('complete')
  })
})
