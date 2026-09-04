import { describe, expect, it } from 'vitest'
import {
  clearCancelledRejectedLnkGeneratedData,
  clearDisabledLnkRequests,
  normalizeActiveLnkDefectDescriptions,
  restoreActiveLnkCancelledResults,
  withTouchedLnkTimestamp,
} from './lnk-field-updates'
import type { WeldInput } from './weld-fields'

describe('clearCancelledRejectedLnkGeneratedData', () => {
  it('clears request, result, conclusion date and conclusion for cancelled rejected LNK results', () => {
    const row = clearCancelledRejectedLnkGeneratedData({
      hasVik: 'отменен',
      vikRequest: 'Заявка-001',
      vikResult: 'ремонт',
      vikConclusionDate: '30.06.2026',
      vikConclusion: 'Заключение-ВИК-30.06.2026-001',
    } as WeldInput)

    expect(row.vikRequest).toBeNull()
    expect(row.vikResult).toBeNull()
    expect(row.vikConclusionDate).toBeNull()
    expect(row.vikConclusion).toBeNull()
  })

  it('keeps generated data for cancelled positive LNK results', () => {
    const row = clearCancelledRejectedLnkGeneratedData({
      hasVik: 'отменен',
      vikRequest: 'Заявка-001',
      vikResult: 'годен',
      vikConclusionDate: '30.06.2026',
      vikConclusion: 'Заключение-ВИК-30.06.2026-001',
    } as WeldInput)

    expect(row.vikRequest).toBe('Заявка-001')
    expect(row.vikConclusionDate).toBe('30.06.2026')
    expect(row.vikConclusion).toBe('Заключение-ВИК-30.06.2026-001')
  })

  it('keeps RK exposure history when a rejected RK result is cancelled', () => {
    const row = clearCancelledRejectedLnkGeneratedData({
      hasRk: 'отменен',
      rkRequest: 'Заявка-РК-001',
      rkResult: 'ремонт',
      rkConclusionDate: '30.06.2026',
      rkConclusion: 'Заключение-РК-30.06.2026-001',
      lnkDefectDescription: '0-250: дефект 12 мм\n250-0:',
      rkExposureConfirmedDiameter: 159,
    } as WeldInput)

    expect(row.rkRequest).toBeNull()
    expect(row.rkResult).toBeNull()
    expect(row.rkConclusionDate).toBeNull()
    expect(row.rkConclusion).toBeNull()
    expect(row.lnkDefectDescription).toBe('0-250: дефект 12 мм\n250-0:')
    expect(row.rkExposureConfirmedDiameter).toBe(159)
  })

  it('keeps a simple defect description as read-only history when a rejected control is cancelled', () => {
    const row = clearCancelledRejectedLnkGeneratedData({
      hasUzk: 'отменен',
      uzkRequest: 'Заявка-УЗК-001',
      uzkResult: 'ремонт',
      uzkConclusion: 'ЗНК-УЗК-001',
      uzkDefectDescription: 'Несплошность',
    } as WeldInput)

    expect(row.uzkResult).toBeNull()
    expect(row.uzkDefectDescription).toBe('Несплошность')
  })
})

describe('clearDisabledLnkRequests', () => {
  it('clears request-only data when control availability is empty', () => {
    const row = clearDisabledLnkRequests({
      hasVik: null,
      vikRequest: 'Заявка-001',
    } as WeldInput)

    expect(row.vikRequest).toBeNull()
  })

  it('clears pending NDT status together with request-only data', () => {
    const row = clearDisabledLnkRequests({
      hasVik: null,
      vikRequest: 'Заявка-001',
      vikResult: 'ожидает НК',
    } as WeldInput)

    expect(row.vikRequest).toBeNull()
    expect(row.vikResult).toBeNull()
  })

  it('clears pending NDT request when availability is cancelled', () => {
    const row = clearDisabledLnkRequests({
      hasVik: 'отменен',
      vikRequest: 'Заявка-001',
      vikResult: 'ожидает НК',
    } as WeldInput)

    expect(row.vikRequest).toBeNull()
    expect(row.vikResult).toBeNull()
  })

  it('clears pending request status together with request-only data', () => {
    const row = clearDisabledLnkRequests({
      hasVik: null,
      vikResult: 'ожидает заявку',
    } as WeldInput)

    expect(row.vikResult).toBeNull()
  })

  it('keeps request when a result trace already exists', () => {
    const row = clearDisabledLnkRequests({
      hasVik: null,
      vikRequest: 'Заявка-001',
      vikResult: 'годен',
    } as WeldInput)

    expect(row.vikRequest).toBe('Заявка-001')
  })

  it('keeps request when a control date trace already exists', () => {
    const row = clearDisabledLnkRequests({
      hasVik: null,
      vikRequest: 'Заявка-001',
      vikConclusionDate: '30.06.2026',
    } as WeldInput)

    expect(row.vikRequest).toBe('Заявка-001')
  })
})

describe('restoreActiveLnkCancelledResults', () => {
  it('restores cancelled positive result when LNK availability becomes active again', () => {
    const row = restoreActiveLnkCancelledResults({
      hasRk: 'да',
      rkResult: 'годен (отменен)',
    } as WeldInput)

    expect(row.rkResult).toBe('годен')
  })

  it('clears cancelled result when LNK availability becomes active again', () => {
    const row = restoreActiveLnkCancelledResults({
      hasRk: 'да',
      rkResult: 'отменен',
    } as WeldInput)

    expect(row.rkResult).toBeNull()
  })

  it('keeps cancelled result while LNK availability remains cancelled', () => {
    const row = restoreActiveLnkCancelledResults({
      hasRk: 'отменен',
      rkResult: 'отменен',
    } as WeldInput)

    expect(row.rkResult).toBe('отменен')
  })

  it('clears preserved simple defect history when the control is restored without a result', () => {
    const row = restoreActiveLnkCancelledResults({
      hasUzk: 'да',
      uzkResult: null,
      uzkDefectDescription: 'Историческое описание',
    } as WeldInput)

    expect(row.uzkDefectDescription).toBeNull()
  })
})

describe('normalizeActiveLnkDefectDescriptions', () => {
  it('enforces DNO and empty pending descriptions while preserving rejected text', () => {
    const row = normalizeActiveLnkDefectDescriptions({
      hasVik: 'да',
      vikResult: 'годен',
      vikDefectDescription: null,
      hasUzk: 'да',
      uzkResult: 'ожидает НК',
      uzkDefectDescription: 'Устаревшее описание',
      hasPvk: 'да',
      pvkResult: 'ремонт',
      pvkDefectDescription: 'Трещина',
    })

    expect(row.vikDefectDescription).toBe('ДНО')
    expect(row.uzkDefectDescription).toBeNull()
    expect(row.pvkDefectDescription).toBe('Трещина')
  })

  it('keeps descriptions stored as cancelled history', () => {
    const row = normalizeActiveLnkDefectDescriptions({
      hasVik: 'отменен',
      vikResult: null,
      vikDefectDescription: 'Историческое описание',
    })

    expect(row.vikDefectDescription).toBe('Историческое описание')
  })
})

describe('withTouchedLnkTimestamp', () => {
  it('keeps the first LNK timestamp and refreshes only the update timestamp', () => {
    const row = withTouchedLnkTimestamp({
      lnkCreatedAt: '2026-07-01T10:00:00.000Z',
      lnkUpdatedAt: '2026-07-02T10:00:00.000Z',
    } as WeldInput)

    expect(row.lnkCreatedAt).toBe('2026-07-01T10:00:00.000Z')
    expect(row.lnkUpdatedAt).not.toBe('2026-07-02T10:00:00.000Z')
  })

  it('initializes both LNK timestamps on the first profile action', () => {
    const row = withTouchedLnkTimestamp({} as WeldInput)

    expect(row.lnkCreatedAt).toBeTruthy()
    expect(row.lnkUpdatedAt).toBe(row.lnkCreatedAt)
  })
})
