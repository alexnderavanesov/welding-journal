import { describe, expect, it } from 'vitest'
import { getPstoDisplayValue, getWeldingJournalDisplayValue } from '@/lib/lnk-status'
import type { WeldInput } from '@/lib/weld-fields'

describe('getWeldingJournalDisplayValue', () => {
  it('shows no need for pending controls when another LNK method rejected the joint', () => {
    const row = {
      hasVik: 'да',
      vikResult: 'ожидает НК',
      hasRk: 'да',
      rkResult: 'вырез',
      pstoRequired: 'да',
      pstoResult: 'ожидает заявку',
      finalStatus: 'не годен',
    } as WeldInput

    expect(getWeldingJournalDisplayValue(row, 'vikResult')).toBe('нет потребности')
    expect(getWeldingJournalDisplayValue(row, 'rkResult')).toBe('вырез')
    expect(getWeldingJournalDisplayValue(row, 'pstoResult')).toBe('нет потребности')
  })

  it('shows no need in heat treatment report when joint is already rejected', () => {
    const row = {
      pstoRequired: 'да',
      pstoRequest: 'ПСТО-30.06.26-001',
      pstoResult: 'ожидает заявку',
      finalStatus: 'не годен',
    } as WeldInput

    expect(getPstoDisplayValue(row, 'pstoResult')).toBe('нет потребности')
  })
})
