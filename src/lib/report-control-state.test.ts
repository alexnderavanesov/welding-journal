import { describe, expect, it } from 'vitest'
import { canSelectLnkResultRow } from '@/lib/lnk-result-modal-rows'
import { getLnkDisplayValue } from '@/lib/lnk-status'
import { canSelectPstoResultRow } from '@/lib/psto-modal-rows'
import {
  canCreateLnkRequest,
  hasAnyLnkGeneratedData,
  hasAnyLnkReportControl,
  hasHeatTreatmentReportState,
  toHeatTreatmentReportRow,
  toControlCancellationReportRow,
  withPendingLnkResults,
} from '@/lib/report-control-state'
import {
  canAddPstoWorkflowResult,
  canCreatePstoRequest,
  getPstoRequestBlockReason,
  getPstoWorkflowRequestBlockReason,
  getPstoWorkflowResultBlockReason,
} from '@/lib/psto-status'
import type { WeldInput } from '@/lib/weld-fields'

describe('cancelled report controls', () => {
  it('keeps TVMT cycle fields outside generated LNK result state', () => {
    expect(hasAnyLnkGeneratedData({ tvmtResult: 'годен', tvmtConclusion: 'ТВМТ-1' })).toBe(false)
    expect(hasAnyLnkGeneratedData({ vikResult: 'годен', vikConclusion: 'ВИК-1' })).toBe(true)
  })

  it('keeps cancelled LNK controls visible but unavailable for new actions', () => {
    const row: WeldInput = {
      hasVik: 'отменен',
      vikRequest: 'Заявка-01',
    }

    expect(hasAnyLnkReportControl(row)).toBe(true)
    expect(canCreateLnkRequest(row)).toBe(false)
    expect(canSelectLnkResultRow(row, '', 'vikRequest')).toBe(false)
  })

  it('keeps cancelled PSTO controls visible but unavailable for new actions', () => {
    const row: WeldInput = {
      pstoRequired: 'отменен',
      pstoRequest: 'ПСТО-01',
    }

    expect(hasHeatTreatmentReportState(row)).toBe(true)
    expect(canCreatePstoRequest(row)).toBe(false)
    expect(canSelectPstoResultRow(row, '')).toBe(false)
  })

  it('keeps performed PSTO history visible after moving the joint to an unassigned line', () => {
    const row: WeldInput = {
      pstoRequired: null,
      pstoRequest: 'ПСТО-01',
      pstoResult: 'проведено',
    }

    expect(hasHeatTreatmentReportState(row)).toBe(true)
    expect(toHeatTreatmentReportRow(row).pstoCycleSummary).toBe('Основной · ожидает заявку ТВМТ')
  })

  it('explains that cancellation blocks another cycle after failed TVMT', () => {
    const row: WeldInput = {
      pstoRequired: 'отменен',
      pstoRequest: 'ПСТО-01',
      pstoDate: '2026-08-05',
      pstoResult: 'проведено',
      tvmtRequest: 'ТВМТ-01',
      tvmtResult: 'не годен',
    }

    expect(getPstoWorkflowRequestBlockReason(row)).toBe(
      'ПСТО по линии отменена; новые циклы недоступны.',
    )
  })

  it('blocks a primary PSTO request until assigned pre-TO controls are complete', () => {
    const waitingRequest = {
      pstoRequired: 'да',
      hasVik: 'да',
    } as WeldInput
    expect(canCreatePstoRequest(waitingRequest)).toBe(false)
    expect(getPstoRequestBlockReason(waitingRequest)).toBe('Сначала создайте заявки НК до ТО: ВИК.')
    expect(getPstoWorkflowRequestBlockReason(waitingRequest)).toBe('Сначала создайте заявки НК до ТО: ВИК.')
    expect(getPstoWorkflowResultBlockReason(waitingRequest)).toBe('Сначала создайте заявки НК до ТО: ВИК.')

    const ready = {
      ...waitingRequest,
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        result: 'годен',
      }],
    } as unknown as WeldInput
    expect(canCreatePstoRequest(ready)).toBe(true)
    expect(getPstoRequestBlockReason(ready)).toBe('')
  })

  it('enables a PSTO result only for the current cycle with an existing request', () => {
    const waitingResult = {
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО-001',
      pstoRequestDate: '2026-08-28',
      pstoResult: 'ожидает',
    } as WeldInput

    expect(canAddPstoWorkflowResult(waitingResult)).toBe(true)
    expect(getPstoWorkflowResultBlockReason(waitingResult)).toBe('')
    expect(getPstoWorkflowRequestBlockReason(waitingResult)).toBe(
      'Заявка ПСТО для цикла 1 уже создана: Заявка ПСТО-001.',
    )

    const completed = { ...waitingResult, pstoResult: 'проведено' }
    expect(canAddPstoWorkflowResult(completed)).toBe(false)
    expect(getPstoWorkflowResultBlockReason(completed)).toBe('Результат ПСТО для цикла 1 уже внесен.')
  })

  it('does not offer a primary LNK request before the PSTO chain is complete', () => {
    expect(canCreateLnkRequest({
      pstoRequired: 'да',
      hasVik: 'да',
    })).toBe(false)
  })

  it('exposes the current repeat-cycle state as a filterable report value', () => {
    const row = toHeatTreatmentReportRow({
      id: 1,
      pstoRequired: 'да',
      pstoRequest: 'ПСТО-1',
      pstoResult: 'проведено',
      tvmtRequest: 'ТВМТ-1',
      tvmtResult: 'не годен',
      pstoRepeatCycles: [{
        id: 2,
        weldJointId: 1,
        sequence: 2,
        pstoRequest: 'ПСТО-2',
      }],
    } as unknown as WeldInput)

    expect(row.pstoCycleSummary).toBe('Повтор #2 · ожидает ПСТО')
  })

  it('shows cancelled controls in result columns without clearing stored history', () => {
    const row = toControlCancellationReportRow({
      hasVik: 'отменен',
      vikRequest: 'Заявка-01',
      vikResult: 'ожидает НК',
      pstoRequired: 'отменен',
      pstoRequest: 'ПСТО-01',
      pstoResult: 'ожидает',
    } as WeldInput)

    expect(row.hasVik).toBe('отменен')
    expect(row.vikResult).toBe('отменен')
    expect(row.pstoRequired).toBe('отменен')
    expect(row.pstoResult).toBe('отменен')
  })

  it('shows positive cancelled LNK and PSTO results as chargeable cancelled statuses', () => {
    const row = toControlCancellationReportRow({
      hasVik: 'отменен',
      vikRequest: 'Заявка-01',
      vikResult: 'годен',
      pstoRequired: 'отменен',
      pstoRequest: 'ПСТО-01',
      pstoResult: 'проведено',
    } as WeldInput)

    expect(row.hasVik).toBe('отменен')
    expect(row.vikResult).toBe('годен (отменен)')
    expect(row.pstoRequired).toBe('отменен')
    expect(row.pstoResult).toBe('проведено (отменен)')
  })

  it('fills active LNK result with waiting request status when request is missing', () => {
    const row = withPendingLnkResults({
      hasRk: 'да',
      rkRequest: null,
      rkResult: null,
    } as WeldInput)

    expect(row.rkResult).toBe('ожидает заявку')
  })

  it('fills active LNK result with waiting NDT status when request exists', () => {
    const row = withPendingLnkResults({
      hasRk: 'да',
      rkRequest: 'Заявка-001',
      rkResult: null,
    } as WeldInput)

    expect(row.rkResult).toBe('ожидает НК')
  })

  it('normalizes stale waiting request status to waiting NDT when request exists', () => {
    const row = withPendingLnkResults({
      hasRk: 'да',
      rkRequest: 'Заявка-001',
      rkResult: 'ожидает заявку',
    } as WeldInput)

    expect(row.rkResult).toBe('ожидает НК')
    expect(getLnkDisplayValue(row, 'rkResult')).toBe('ожидает НК')
  })
})
