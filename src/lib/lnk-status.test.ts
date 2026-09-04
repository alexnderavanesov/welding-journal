import { describe, expect, it } from 'vitest'
import {
  getJointChainResultItems,
  getPstoDisplayValue,
  getWeldingJournalDisplayValue,
} from '@/lib/lnk-status'
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

  it('shows no need for the whole pending PSTO cycle after rejected pre-TO control', () => {
    const row = {
      pstoRequired: 'да',
      pstoResult: 'ожидает заявку',
      hasVik: 'да',
      preHeatTreatmentControls: [{
        id: 7,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        result: 'вырез',
      }],
      finalStatus: 'не годен',
    } as unknown as WeldInput

    expect(getPstoDisplayValue(row, 'pstoResult')).toBe('нет потребности')
    expect(getPstoDisplayValue(row, 'pstoCycleSummary')).toBe('нет потребности')
    expect(getJointChainResultItems(row).map(({ stage, label, value }) => ({ stage, label, value }))).toEqual([
      { stage: 'pstoTvmt', label: 'Цикл 1', value: 'нет потребности' },
      { stage: 'mainLnk', label: 'ВИК', value: 'нет потребности' },
    ])
  })

  it('restores the normal PSTO sequence after the rejected pre-TO result is corrected', () => {
    const row = {
      pstoRequired: 'да',
      pstoResult: 'ожидает заявку',
      hasVik: 'да',
      preHeatTreatmentControls: [{
        id: 7,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        result: 'годен',
      }],
      finalStatus: 'ожидает заявку',
    } as unknown as WeldInput

    expect(getPstoDisplayValue(row, 'pstoResult')).toBe('ожидает заявку')
    expect(getPstoDisplayValue(row, 'pstoCycleSummary')).toBe('Основной · ожидает заявку ПСТО')
    expect(getJointChainResultItems(row).map(({ label, value }) => ({ label, value }))).toContainEqual({
      label: 'Цикл 1',
      value: 'ожидает заявку ПСТО',
    })
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

describe('getJointChainResultItems', () => {
  it('shows the current PSTO cycle before only the main LNK stage', () => {
    const row = {
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО 1',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ 1',
      tvmtResult: 'не годен',
      pstoRepeatCycles: [{
        id: 22,
        weldJointId: 1,
        sequence: 2,
        pstoRequest: 'Заявка ПСТО 2',
        pstoResult: 'проведено',
        tvmtRequest: 'Заявка ТВМТ 2',
        tvmtResult: 'ожидает НК',
      }],
      hasVik: 'да',
      vikRequest: 'Заявка ВИК основная',
      vikResult: 'ожидает НК',
      preHeatTreatmentControls: [{
        id: 7,
        weldJointId: 1,
        method: 'ВИК',
        result: 'годен',
      }],
    } as unknown as WeldInput

    const items = getJointChainResultItems(row)

    expect(items.map(({ stage, label, value }) => ({ stage, label, value }))).toEqual([
      { stage: 'pstoTvmt', label: 'Цикл 2', value: 'ожидает ТВМТ' },
      { stage: 'mainLnk', label: 'ВИК', value: 'ожидает НК' },
    ])
    expect(items.some((item) => item.value === 'проведено')).toBe(false)
    expect(items.some((item) => item.label.includes('до ТО'))).toBe(false)
  })

  it('marks PSTO as completed only after a good TVMT result', () => {
    const row = {
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО 1',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ 1',
      tvmtResult: 'годен',
    } as WeldInput

    expect(getJointChainResultItems(row).map(({ stage, label, value }) => ({ stage, label, value }))).toEqual([
      { stage: 'pstoTvmt', label: 'ПСТО', value: 'проведено' },
      { stage: 'pstoTvmt', label: 'ТВМТ', value: 'годен' },
    ])
  })

  it('shows the failed TVMT and the required next PSTO cycle', () => {
    const row = {
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО 1',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ 1',
      tvmtResult: 'не годен',
    } as WeldInput

    expect(getJointChainResultItems(row).map(({ stage, label, value }) => ({ stage, label, value }))).toEqual([
      { stage: 'pstoTvmt', label: 'ТВМТ · цикл 1', value: 'не годен' },
      { stage: 'pstoTvmt', label: 'ПСТО', value: 'требуется цикл 2' },
    ])
  })

  it('keeps an unfinished physical cycle visible after the PSTO line is cancelled', () => {
    const row = {
      pstoRequired: 'отменен',
      pstoRequest: 'Заявка ПСТО 1',
      pstoDate: '2026-08-20',
      pstoResult: 'проведено',
    } as WeldInput

    expect(getJointChainResultItems(row).map(({ stage, label, value }) => ({ stage, label, value }))).toEqual([
      { stage: 'pstoTvmt', label: 'Линия ПСТО', value: 'отменена' },
      { stage: 'pstoTvmt', label: 'Цикл 1', value: 'ожидает заявку ТВМТ' },
    ])
  })

  it('shows a failed final TVMT without claiming that cancelled PSTO was successful', () => {
    const row = {
      pstoRequired: 'отменен',
      pstoRequest: 'Заявка ПСТО 1',
      pstoDate: '2026-08-20',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ 1',
      tvmtResult: 'не годен',
    } as WeldInput

    const items = getJointChainResultItems(row).map(({ stage, label, value }) => ({ stage, label, value }))
    expect(items).toEqual([
      { stage: 'pstoTvmt', label: 'Линия ПСТО', value: 'отменена' },
      { stage: 'pstoTvmt', label: 'ТВМТ · цикл 1', value: 'не годен' },
    ])
    expect(items).not.toContainEqual(expect.objectContaining({ value: 'проведено' }))
  })
})
