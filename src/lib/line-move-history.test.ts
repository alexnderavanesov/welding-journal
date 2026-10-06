import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { buildPstoMovedToUnassignedLineRow, buildPstoMovedToCancelledLineRow } from './psto-line-assignment'
import { calculateFinalStatus } from './weld-status'
import { getPrimaryRejectedLnkResult } from './repeated-joint-task-helpers'
import { getPstoTvmtWorkflowState } from './tvmt-cycle'
import { buildProgramHistory } from '@/components/line-program-joint-details'
import { hasHeatTreatmentReportState } from './report-control-state'
import { isPrimaryLnkStageReady } from './lnk-control-stage'

const control = { id: 9, weldJointId: 1, method: 'ВИК', requestName: 'PRE-1', requestDate: '2026-09-02', result: 'годен', conclusionName: 'PRE-C1', conclusionDate: '2026-09-03' }
const row = (patch: Partial<WeldRow> = {}): WeldRow => ({ id: 1, joint: 'S1', line: 'Л1', weldDate: '2026-09-01', hasVik: 'да', pstoRequired: 'да', pstoRequest: 'PSTO-1', pstoRequestDate: '2026-09-03', preHeatTreatmentControls: [control], ...patch }) as WeldRow

describe('approved line move: preserve facts or transfer the complete package explicitly', () => {
  it.each([null, 'отменен'])('does not present an inactive unperformed repeat as assignment debt (%s)', pstoRequired => {
    const next = row({ pstoRequired, pstoResult: 'проведено', tvmtResult: 'не годен', pstoRepeatCycles: [{
      id: 12, weldJointId: 1, sequence: 2, pstoRequest: 'P2', pstoRequestDate: '2026-09-04', pstoResult: 'ожидает ПСТО',
    }] })
    const history = buildProgramHistory(next).sections.find(section => section.title === 'ПСТО и ТВМТ')!
    expect(history.controls.find(control => control.id === 'psto-2')).toMatchObject({
      result: 'Сохранённая заявка; выполнение ПСТО не требуется', request: 'P2',
    })
    expect(buildProgramHistory({ ...next, pstoRequired: 'да' }).sections.find(section => section.title === 'ПСТО и ТВМТ')!
      .controls.find(control => control.id === 'psto-2')?.result).toBe('ожидает ПСТО')
  })
  it('keeps retained request-only PSTO history visible without turning it into a current requirement', () => {
    const pending = row({ pstoRequired: null })
    expect(hasHeatTreatmentReportState(pending)).toBe(true)
    expect(getPstoTvmtWorkflowState(pending)).toBe('not-required')
    const waitingOnly = row({ pstoRequired: null, pstoRequest: null, pstoRequestDate: null, pstoResult: 'ожидает заявку' })
    expect(hasHeatTreatmentReportState(waitingOnly)).toBe(false)
  })
  it.each(['unassigned', 'cancelled'] as const)('preserves every stage and pending request on %s without creating PSTO debt', target => {
    const before = row({ pstoRepeatCycles: [{ id: 7, weldJointId: 1, sequence: 2, pstoRequest: 'REPEAT', pstoRequestDate: '2026-09-04' }] })
    const input = { row: before, controls: before.preHeatTreatmentControls!, disposition: 'keepPrimary' as const, cancellationDate: '2026-09-05', cancellationBasis: 'Решение' }
    const next = target === 'cancelled' ? buildPstoMovedToCancelledLineRow(input) : buildPstoMovedToUnassignedLineRow(input)
    expect(next.preHeatTreatmentControls).toEqual([control])
    expect(next.pstoRequest).toBe('PSTO-1')
    expect(next.pstoRepeatCycles).toEqual(before.pstoRepeatCycles)
    expect(next.vikResult).toBeUndefined()
    expect(getPstoTvmtWorkflowState(next)).toBe('not-required')
  })

  it('transfers request-only and completed methods, preserving unrelated primary methods', () => {
    const controls = [control, { id: 10, weldJointId: 1, method: 'РК', requestName: 'PRE-RK', requestDate: '2026-09-03', result: 'ожидает НК' }]
    const next = buildPstoMovedToUnassignedLineRow({ row: row({ preHeatTreatmentControls: controls, uzkRequest: 'MAIN-UZK' }), controls, disposition: 'promoteBeforeHeatTreatment' })
    expect(next).toMatchObject({ vikRequest: 'PRE-1', vikResult: 'годен', vikConclusion: 'PRE-C1', rkRequest: 'PRE-RK', rkResult: 'ожидает НК', uzkRequest: 'MAIN-UZK', pstoRequest: 'PSTO-1', preHeatTreatmentControls: [] })
  })

  it('never overwrites a target method, even if the source only has a pending request', () => {
    const before = row({ vikRequest: 'MAIN-1' })
    expect(() => buildPstoMovedToUnassignedLineRow({ row: before, controls: [control], disposition: 'promoteBeforeHeatTreatment' })).toThrow(/ВИК.*уже заполнен/)
    expect(before.vikRequest).toBe('MAIN-1')
    expect(before.preHeatTreatmentControls).toEqual([control])
  })

  it('cannot reclassify a pre-TO package after actual heat treatment', () => {
    const before = row({ pstoDate: '2026-09-04', pstoResult: 'проведено' })
    expect(() => buildPstoMovedToUnassignedLineRow({ row: before, controls: [control], disposition: 'promoteBeforeHeatTreatment' })).toThrow(/ПСТО.*выполнен/)
  })

  it('a retained rejection remains a rejection and a continuation source without PSTO', () => {
    const before = row({ preHeatTreatmentControls: [{ ...control, result: 'ремонт' }] })
    const next = buildPstoMovedToUnassignedLineRow({ row: before, controls: before.preHeatTreatmentControls!, disposition: 'keepPrimary' })
    expect(calculateFinalStatus(next)).toBe('не годен')
    expect(getPrimaryRejectedLnkResult(next)).toMatchObject({ result: 'ремонт', method: { code: 'ВИК до ТО' } })
    expect(isPrimaryLnkStageReady(next, 'ВИК')).toBe(false)
    // The separately agreed global process switch still excludes pre-TO facts.
    expect(getPrimaryRejectedLnkResult({ ...next, preHeatTreatmentLnkEnabled: false } as WeldRow)).toBeNull()
  })

  it('labels retained history and preserves the actual result, including rejection', () => {
    const next = row({ line: 'Л2', pstoRequired: null, preHeatTreatmentControls: [{ ...control, result: 'ремонт' }] })
    const section = buildProgramHistory(next).sections.find(section => section.title.includes('до ТО'))!
    expect(section.note).toContain('На текущей линии этап не предусмотрен')
    expect(section.controls[0].result).toBe('ремонт')
    expect(section.controls[0].conclusionDocument).toBeDefined()
  })
})
