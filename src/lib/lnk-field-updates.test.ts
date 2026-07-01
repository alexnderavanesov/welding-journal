import { describe, expect, it } from 'vitest'
import { clearCancelledRejectedLnkGeneratedData, clearDisabledLnkRequests, restoreActiveLnkCancelledResults } from './lnk-field-updates'
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
})
