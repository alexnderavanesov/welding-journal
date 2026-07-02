import { describe, expect, it } from 'vitest'
import { canSelectLnkResultRow } from '@/lib/lnk-result-modal-rows'
import { getLnkDisplayValue } from '@/lib/lnk-status'
import { canSelectPstoResultRow } from '@/lib/psto-modal-rows'
import {
  canCreateLnkRequest,
  hasAnyLnkReportControl,
  hasHeatTreatmentReportState,
  toControlCancellationReportRow,
  withPendingLnkResults,
} from '@/lib/report-control-state'
import { canCreatePstoRequest } from '@/lib/psto-status'
import type { WeldInput } from '@/lib/weld-fields'

describe('cancelled report controls', () => {
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
