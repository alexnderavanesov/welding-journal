import { describe, expect, it } from 'vitest'

import type { PstoRepeatCycleRecord } from '@/lib/psto-cycle'
import {
  canCreateRepeatPstoCycle,
  getNextPstoCycleSequence,
  getPstoTvmtPendingFinalStatus,
  getPstoTvmtWorkflowState,
  getPstoCycleSummary,
  normalizeTvmtResult,
} from '@/lib/tvmt-cycle'
import type { WeldInput } from '@/lib/weld-fields'

describe('PSTO and TVMT cycle', () => {
  it('requires TVMT from PSTO assignment rather than the legacy TVMT flag', () => {
    expect(getPstoTvmtWorkflowState({ pstoRequired: 'да', hasTvmt: null })).toBe('waiting-psto-request')
    expect(getPstoTvmtWorkflowState({ pstoRequired: null, hasTvmt: 'да' })).toBe('not-required')
  })

  it('shows the pre-TO prerequisite instead of a misleading PSTO request status', () => {
    expect(getPstoCycleSummary(
      { pstoRequired: 'да' } as WeldInput,
      'ожидает заявку НК до ТО: ВИК',
    )).toBe('Основной · ожидает заявку НК до ТО: ВИК')
  })

  it('moves from completed PSTO to the TVMT request and result', () => {
    const afterPsto = row({ pstoResult: 'проведено' })
    expect(getPstoTvmtWorkflowState(afterPsto)).toBe('waiting-tvmt-request')
    expect(getPstoTvmtPendingFinalStatus(getPstoTvmtWorkflowState(afterPsto))).toBe('ожидает заявку')

    const requested = row({ pstoResult: 'проведено', tvmtRequest: 'Заявка ТВМТ-001' })
    expect(getPstoTvmtWorkflowState(requested)).toBe('waiting-tvmt')
    expect(getPstoTvmtPendingFinalStatus(getPstoTvmtWorkflowState(requested))).toBe('ожидает НК')

    expect(getPstoTvmtWorkflowState(row({
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ-001',
      tvmtResult: 'годен',
    }))).toBe('complete')
  })

  it('keeps a performed cycle active after moving the joint to a line without PSTO', () => {
    expect(getPstoTvmtWorkflowState({
      pstoRequired: null,
      pstoRequest: 'Заявка ПСТО-001',
      pstoResult: 'проведено',
    } as WeldInput)).toBe('waiting-tvmt-request')

    expect(getPstoTvmtWorkflowState({
      pstoRequired: null,
      pstoRequest: 'Заявка ПСТО-001',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ-001',
      tvmtResult: 'годен',
    } as WeldInput)).toBe('complete')
  })

  it('requires another PSTO after a failed TVMT without rejecting the weld', () => {
    const failed = row({
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ-001',
      tvmtResult: 'не годен',
    })

    expect(getPstoTvmtWorkflowState(failed)).toBe('repeat-psto-required')
    expect(canCreateRepeatPstoCycle(failed)).toBe(true)
    expect(getNextPstoCycleSequence(failed)).toBe(2)
  })

  it('does not open a new cycle after failed TVMT when the line assignment is cancelled', () => {
    const cancelledAfterFailedTvmt = row({
      pstoRequired: 'отменен',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ-001',
      tvmtResult: 'не годен',
    })

    expect(getPstoTvmtWorkflowState(cancelledAfterFailedTvmt)).toBe('complete')
    expect(canCreateRepeatPstoCycle(cancelledAfterFailedTvmt)).toBe(false)
    expect(getPstoCycleSummary(cancelledAfterFailedTvmt)).toBe(
      'Основной · цикл завершен · линия отменена',
    )
  })

  it('still lets a physically performed cycle reach its TVMT result after cancellation', () => {
    const cancelledAfterPsto = row({
      pstoRequired: 'отменен',
      pstoResult: 'проведено',
      tvmtRequest: null,
      tvmtResult: null,
    })
    expect(getPstoTvmtWorkflowState(cancelledAfterPsto)).toBe('waiting-tvmt-request')

    expect(getPstoTvmtWorkflowState({
      ...cancelledAfterPsto,
      tvmtRequest: 'Заявка ТВМТ-001',
    })).toBe('waiting-tvmt')
  })

  it('uses the latest repeat cycle as the current state', () => {
    const base = row({
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ-001',
      tvmtResult: 'не годен',
    })
    const repeats: PstoRepeatCycleRecord[] = [{
      id: 5,
      weldJointId: 1,
      sequence: 2,
      pstoRequest: 'Заявка ПСТО-002',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ-002',
      tvmtResult: 'годен',
    }]

    expect(getPstoTvmtWorkflowState(base, repeats)).toBe('complete')
    expect(canCreateRepeatPstoCycle(base, repeats)).toBe(false)
    expect(getNextPstoCycleSequence(base, repeats)).toBe(3)
    expect(getPstoCycleSummary({
      ...base,
      pstoRepeatCycles: repeats,
    } as unknown as WeldInput)).toBe('Повтор #2 · цикл завершен')
  })

  it('treats legacy repair and cut TVMT values as a repeat trigger', () => {
    expect(normalizeTvmtResult('ремонт')).toBe('failed')
    expect(normalizeTvmtResult('вырез')).toBe('failed')
  })

  it('does not let duplicate controls affect the PSTO and TVMT cycle', () => {
    expect(getPstoTvmtWorkflowState({
      ...row({ pstoResult: 'проведено', tvmtRequest: 'ТВМТ-1', tvmtResult: 'годен' }),
      duplicateControls: [{ method: 'РК', result: 'ремонт' }],
    } as WeldInput)).toBe('complete')
  })
})

function row(values: WeldInput = {}): WeldInput {
  return {
    id: 1,
    pstoRequired: 'да',
    pstoRequest: 'Заявка ПСТО-001',
    ...values,
  } as WeldInput
}
