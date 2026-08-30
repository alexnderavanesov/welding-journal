import { describe, expect, it } from 'vitest'

import {
  normalizePreHeatTreatmentLnkResultCorrectionPayload,
  normalizePreHeatTreatmentLnkWorkflowPayload,
} from '@/server/pre-heat-treatment-lnk-workflow'

describe('pre-heat-treatment LNK workflow payload', () => {
  it('keeps only supported staged positions', () => {
    expect(normalizePreHeatTreatmentLnkWorkflowPayload({
      action: 'request',
      date: '2026-08-04',
      groups: [{
        name: 'Заявка до ТО-1',
        positions: [
          { rowId: 1, methodCode: 'ВИК' },
          { rowId: 1, methodCode: 'ВИК' },
          { rowId: 2, methodCode: 'РК' },
          { rowId: 3, methodCode: 'ТВМТ' as 'ВИК' },
        ],
      }],
    }).groups[0]?.positions).toEqual([
      { rowId: 1, methodCode: 'ВИК' },
      { rowId: 2, methodCode: 'РК' },
    ])
  })

  it('does not allow one staged position in two documents', () => {
    expect(() => normalizePreHeatTreatmentLnkWorkflowPayload({
      action: 'request',
      date: '2026-08-04',
      groups: [
        { name: 'Заявка 1', positions: [{ rowId: 1, methodCode: 'ВИК' }] },
        { name: 'Заявка 2', positions: [{ rowId: 1, methodCode: 'ВИК' }] },
      ],
    })).toThrow('нельзя включить в несколько документов')
  })

  it('requires one result for every selected position', () => {
    expect(() => normalizePreHeatTreatmentLnkWorkflowPayload({
      action: 'result',
      date: '2026-08-05',
      groups: [{
        name: 'ЗНК-ВИК-1',
        positions: [
          { rowId: 1, methodCode: 'ВИК' },
          { rowId: 2, methodCode: 'ВИК' },
        ],
      }],
      results: [{ rowId: 1, methodCode: 'ВИК', result: 'годен' }],
    })).toThrow('для каждой выбранной позиции')
  })

  it('does not accept duplicate results as coverage for another selected position', () => {
    expect(() => normalizePreHeatTreatmentLnkWorkflowPayload({
      action: 'result',
      date: '2026-08-05',
      groups: [{
        name: 'ЗНК-ВИК-1',
        positions: [
          { rowId: 1, methodCode: 'ВИК' },
          { rowId: 2, methodCode: 'ВИК' },
        ],
      }],
      results: [
        { rowId: 1, methodCode: 'ВИК', result: 'годен' },
        { rowId: 1, methodCode: 'ВИК', result: 'ремонт' },
      ],
    })).toThrow('указан несколько раз')
  })

  it('rejects a non-numeric RK exposure diameter', () => {
    expect(() => normalizePreHeatTreatmentLnkWorkflowPayload({
      action: 'result',
      date: '2026-08-05',
      groups: [{
        name: 'ЗНК-РК-1',
        positions: [{ rowId: 1, methodCode: 'РК' }],
      }],
      results: [{
        rowId: 1,
        methodCode: 'РК',
        result: 'годен',
        rkExposureConfirmedDiameter: 'не число' as unknown as number,
      }],
    })).toThrow('должен быть числом')
  })

  it('normalizes result corrections without accepting an unknown relation or action', () => {
    expect(normalizePreHeatTreatmentLnkResultCorrectionPayload({
      relationId: 7.9,
      action: 'update',
      result: ' годен ',
      conclusionDate: ' 2026-08-05 ',
      conclusionName: ' ЗНК-ВИК-1 ',
    })).toEqual({
      relationId: 7,
      stage: 'result',
      action: 'update',
      requestDate: '',
      requestName: '',
      result: 'годен',
      conclusionDate: '2026-08-05',
      conclusionName: 'ЗНК-ВИК-1',
    })

    expect(() => normalizePreHeatTreatmentLnkResultCorrectionPayload({
      relationId: 0,
      action: 'delete',
    })).toThrow('Не указан результат')
    expect(() => normalizePreHeatTreatmentLnkResultCorrectionPayload({
      relationId: 1,
      action: 'replace' as 'update',
    })).toThrow('Неизвестное изменение')
  })

  it('normalizes request-stage corrections independently from results', () => {
    expect(normalizePreHeatTreatmentLnkResultCorrectionPayload({
      relationId: 8,
      stage: 'request',
      action: 'update',
      requestDate: ' 2026-08-03 ',
      requestName: ' Заявка до ТО ',
    })).toEqual(expect.objectContaining({
      relationId: 8,
      stage: 'request',
      action: 'update',
      requestDate: '2026-08-03',
      requestName: 'Заявка до ТО',
    }))
  })
})
