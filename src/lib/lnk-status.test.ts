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

  it('shows the latest repeat PSTO and TVMT cycle instead of the primary cycle', () => {
    const row = {
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО основная',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ основная',
      tvmtResult: 'не годен',
      pstoRepeatCycles: [{
        id: 21,
        weldJointId: 1,
        sequence: 2,
        pstoRequest: 'Заявка ПСТО повтор 2',
        pstoRequestDate: '2026-08-20',
        pstoResult: 'проведено',
        heatTreatmentDiagram: 'Диаграмма повтор 2',
        tvmtRequest: 'Заявка ТВМТ повтор 2',
        tvmtResult: 'годен',
        tvmtConclusion: 'ТВМТ повтор 2',
      }],
    } as unknown as WeldInput

    expect(getPstoDisplayValue(row, 'pstoRequest')).toBe('Заявка ПСТО повтор 2')
    expect(getPstoDisplayValue(row, 'heatTreatmentDiagram')).toBe('Диаграмма повтор 2')
    expect(getPstoDisplayValue(row, 'tvmtRequest')).toBe('Заявка ТВМТ повтор 2')
    expect(getPstoDisplayValue(row, 'tvmtResult')).toBe('годен')
    expect(getPstoDisplayValue(row, 'tvmtConclusion')).toBe('ТВМТ повтор 2')
  })
})
