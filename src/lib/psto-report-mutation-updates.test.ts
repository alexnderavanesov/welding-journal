import { describe, expect, it } from 'vitest'

import {
  buildPstoRequestRows,
  buildPstoResultRows,
  buildPstoRequestManagerRows,
  buildPstoRequestCorrectionRow,
  buildPstoResultCorrectionRow,
} from '@/lib/psto-report-mutation-updates'
import type { RowWithId } from '@/lib/psto-report-mutation-types'
import {
  DEFAULT_SAVE_CHECK_SETTINGS,
  saveSaveCheckSettings,
} from '@/lib/save-check-settings'

describe('buildPstoResultRows', () => {
  it('keeps the diagram empty when its save check is disabled', () => {
    saveSaveCheckSettings({
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      pstoResultDiagramRequired: false,
    }, { syncRemote: false })
    const rows = [{
      id: 1,
      joint: 'F1',
      weldDate: '2026-08-20',
      pstoRequest: 'ПСТО-25.08.26-001',
      pstoRequestDate: '2026-08-21',
    }] as RowWithId[]

    const [updated] = buildPstoResultRows({
      records: rows,
      rows,
      pstoDate: '2026-08-25',
      result: 'проведено',
      diagramName: '',
    })

    expect(updated.pstoResult).toBe('проведено')
    expect(updated.pstoDate).toBe('2026-08-25')
    expect(updated.heatTreatmentDiagram).toBe('')
  })

  it('refuses primary PSTO while assigned pre-TO control is incomplete', () => {
    const row = {
      id: 1,
      joint: 'F1',
      weldDate: '2026-08-20',
      pstoRequired: 'да',
      hasVik: 'да',
      pstoRequest: 'ПСТО-25.08.26-001',
      pstoRequestDate: '2026-08-21',
      preHeatTreatmentControls: [],
    } as RowWithId

    expect(() => buildPstoResultRows({
      records: [row],
      rows: [row],
      pstoDate: '2026-08-25',
      result: 'проведено',
      diagramName: 'Диаграмма-1',
    })).toThrow('создайте заявки НК до ТО: ВИК')

    expect(() => buildPstoRequestRows({
      records: [{ ...row, pstoRequest: null, pstoRequestDate: null }],
      requestName: 'ПСТО-25.08.26-002',
      requestDate: '2026-08-22',
    })).toThrow('создайте заявки НК до ТО: ВИК')
  })

  it('refuses a PSTO result dated before an existing pre-TO conclusion', () => {
    const row = {
      id: 1,
      joint: 'F1',
      weldDate: '2026-08-20',
      pstoRequired: 'да',
      hasVik: 'да',
      pstoRequest: 'ПСТО-25.08.26-001',
      pstoRequestDate: '2026-08-24',
      preHeatTreatmentControls: [{
        id: 11,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        requestDate: '2026-08-24',
        result: 'годен',
        conclusionDate: '2026-08-26',
        conclusionName: 'Заключение ВИК до ТО',
      }],
    } as RowWithId

    expect(() => buildPstoResultRows({
      records: [row],
      rows: [row],
      pstoDate: '2026-08-25',
      result: 'проведено',
      diagramName: 'Диаграмма-1',
    })).toThrow('позже даты ПСТО')
  })
})

describe('buildPstoResultCorrectionRow', () => {
  it('keeps the PSTO date separate when renaming a custom diagram', () => {
    const updated = buildPstoResultCorrectionRow({
      record: {
        id: 1,
        pstoDate: '2026-07-21',
        heatTreatmentDiagram: 'Диаграмма-001',
      } as RowWithId,
      action: 'renameDiagram',
      diagramName: '  Диаграмма №77  ',
    })

    expect(updated.pstoDate).toBe('2026-07-21')
    expect(updated.heatTreatmentDiagram).toBe('Диаграмма №77')
    expect(updated.pstoCreatedAt).toBeTruthy()
    expect(updated.pstoUpdatedAt).toBeTruthy()
  })

  it('renames only the PSTO request with the matching name and date', () => {
    const rows = [
      {
        id: 1,
        pstoRequest: 'Заявка пользователя',
        pstoRequestDate: '2026-07-21',
      },
      {
        id: 2,
        pstoRequest: 'Заявка пользователя',
        pstoRequestDate: '2026-08-06',
      },
    ] as RowWithId[]

    const updated = buildPstoRequestManagerRows({
      heatTreatmentRows: rows,
      requestName: 'Заявка пользователя',
      requestDate: '2026-08-06',
      nextRequestName: 'Заявка пользователя новая',
      action: 'rename',
    })

    expect(updated).toHaveLength(1)
    expect(updated[0]?.id).toBe(2)
    expect(updated[0]?.pstoRequest).toBe('Заявка пользователя новая')
    expect(updated[0]?.pstoRequestDate).toBe('2026-08-06')
    expect(updated[0]?.pstoUpdatedAt).toBeTruthy()
  })

  it('keeps the first PSTO timestamp while updating the profile timestamp', () => {
    const updated = buildPstoResultCorrectionRow({
      record: {
        id: 1,
        pstoCreatedAt: '2026-07-01T10:00:00.000Z',
        pstoDate: '2026-07-21',
        pstoResult: 'проведено',
        heatTreatmentDiagram: 'Диаграмма-001',
      } as RowWithId,
      action: 'renameDiagram',
      diagramName: 'Диаграмма-002',
    })

    expect(updated.pstoCreatedAt).toBe('2026-07-01T10:00:00.000Z')
    expect(updated.pstoUpdatedAt).toBeTruthy()
  })

  it('deletes a pending PSTO request without treating the waiting marker as a result', () => {
    const row = {
      id: 1,
      joint: 'F1',
      pstoRequired: 'да',
      pstoRequest: 'ПСТО-25.08.26-001',
      pstoRequestDate: '2026-08-25',
      pstoResult: 'ожидает',
    } as RowWithId

    const [updated] = buildPstoRequestManagerRows({
      heatTreatmentRows: [row],
      requestName: 'ПСТО-25.08.26-001',
      requestDate: '2026-08-25',
      nextRequestName: '',
      action: 'delete',
    })

    expect(updated).toEqual(expect.objectContaining({
      pstoRequest: null,
      pstoRequestDate: null,
      pstoResult: null,
    }))
  })

  it('does not cascade request deletion into completed PSTO stages', () => {
    const row = {
      id: 1,
      joint: 'F1',
      pstoRequired: 'да',
      pstoRequest: 'ПСТО-25.08.26-001',
      pstoRequestDate: '2026-08-25',
      pstoResult: 'проведено',
      pstoDate: '2026-08-26',
      heatTreatmentDiagram: 'Диаграмма-001',
    } as RowWithId

    expect(() => buildPstoRequestManagerRows({
      heatTreatmentRows: [row],
      requestName: 'ПСТО-25.08.26-001',
      requestDate: '2026-08-25',
      nextRequestName: '',
      action: 'delete',
    })).toThrow('Сначала удалите последующий этап «Результат ПСТО»')
    expect(() => buildPstoRequestCorrectionRow(row)).toThrow('Цепочка удаляется только с конца')
    expect(row).toEqual(expect.objectContaining({
      pstoRequest: 'ПСТО-25.08.26-001',
      pstoResult: 'проведено',
      heatTreatmentDiagram: 'Диаграмма-001',
    }))
  })
})
