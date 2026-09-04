import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  buildPreHeatTreatmentRequestCorrectionWrite,
  buildPreHeatTreatmentRequestWrites,
  buildPreHeatTreatmentResultCorrectionWrite,
  buildPreHeatTreatmentResultWrite,
  canAddPreHeatTreatmentResult,
  canCreatePreHeatTreatmentRequest,
  getPreHeatTreatmentResultBlockReason,
  getPreHeatTreatmentRequestRemovalBlockReason,
  getPreHeatTreatmentResultRemovalBlockReason,
} from '@/lib/pre-heat-treatment-control-updates'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

describe('pre-heat-treatment control updates', () => {
  it('creates only assigned staged controls and keeps duplicates outside the stage', () => {
    const writes = buildPreHeatTreatmentRequestWrites({
      row: makeRow({
        duplicateControls: [{
          id: 99,
          weldJointId: 1,
          method: 'РК',
          result: 'ремонт',
          controlDate: '2026-08-04',
          conclusion: 'Дубль-1',
          conclusionDate: '2026-08-04',
        }],
      }),
      methodCodes: ['ВИК', 'РК'],
      requestName: 'Заявка до ТО-1',
      requestDate: '2026-08-03',
    })

    expect(writes).toEqual([
      expect.objectContaining({ method: 'ВИК', result: 'ожидает НК' }),
      expect.objectContaining({ method: 'РК', result: 'ожидает НК' }),
    ])
    expect(canCreatePreHeatTreatmentRequest(makeRow({
      duplicateControls: [{
        id: 99,
        weldJointId: 1,
        method: 'ВИК',
        result: 'ремонт',
        controlDate: '2026-08-04',
        conclusion: 'Дубль-1',
        conclusionDate: '2026-08-04',
      }],
    }), 'ВИК')).toBe(true)
  })

  it('clears stale simple-method defects when a pre-TO request is pending', () => {
    const current = control({
      requestName: null,
      requestDate: null,
      result: null,
      conclusionDate: null,
      conclusionName: null,
      defectDescription: 'Старое описание',
    })
    const [created] = buildPreHeatTreatmentRequestWrites({
      row: makeRow({ preHeatTreatmentControls: [current] }),
      methodCodes: ['ВИК'],
      requestName: 'Заявка до ТО-1',
      requestDate: '2026-08-03',
    })
    const corrected = buildPreHeatTreatmentRequestCorrectionWrite({
      row: makeRow(),
      control: { ...current, result: 'ожидает НК' },
      requestDate: '2026-08-03',
      requestName: 'Заявка до ТО-2',
    })

    expect(created.defectDescription).toBeNull()
    expect(corrected.defectDescription).toBeNull()
  })

  it('rejects unsupported methods and controls that are not assigned', () => {
    expect(() => buildPreHeatTreatmentRequestWrites({
      row: makeRow(),
      methodCodes: ['ТВМТ'],
      requestName: 'Заявка до ТО-1',
      requestDate: '2026-08-03',
    })).toThrow('ТВМТ не выполняется как НК до ТО')

    expect(() => buildPreHeatTreatmentRequestWrites({
      row: makeRow({ hasUzk: '' }),
      methodCodes: ['УЗК'],
      requestName: 'Заявка до ТО-1',
      requestDate: '2026-08-03',
    })).toThrow('УЗК не назначен')
  })

  it('allows historical pre-TO completion after performed PSTO is cancelled', () => {
    expect(canCreatePreHeatTreatmentRequest(makeRow({
      pstoRequired: 'отменен',
      pstoResult: 'проведено',
      preHeatTreatmentControls: [],
    }), 'ВИК')).toBe(true)

    expect(canCreatePreHeatTreatmentRequest(makeRow({
      pstoRequired: 'отменен',
      pstoResult: null,
      pstoDate: null,
      preHeatTreatmentControls: [],
    }), 'ВИК')).toBe(false)
  })

  it('keeps requests and conclusions between welding and PSTO', () => {
    expect(() => buildPreHeatTreatmentRequestWrites({
      row: makeRow(),
      methodCodes: ['ВИК'],
      requestName: 'Заявка до ТО-1',
      requestDate: '2026-08-11',
    })).toThrow('не может быть позже даты ПСТО')

    expect(() => buildPreHeatTreatmentResultWrite({
      row: makeRow({
        preHeatTreatmentControls: [control({
          requestDate: '2026-08-03',
          result: 'ожидает НК',
          conclusionDate: '',
          conclusionName: '',
        })],
      }),
      methodCode: 'ВИК',
      controlDate: '2026-08-02',
      result: 'годен',
      conclusionName: 'ЗНК-ВИК-1',
    })).toThrow('не может быть раньше даты заявки')
  })

  it('requires a good VIK before another pre-heat-treatment method', () => {
    const row = makeRow({
      preHeatTreatmentControls: [
        control({ method: 'ВИК', result: 'ожидает НК' }),
        control({ id: 2, method: 'РК', requestName: 'Заявка РК', result: 'ожидает НК' }),
      ],
    })

    expect(() => buildPreHeatTreatmentResultWrite({
      row,
      methodCode: 'РК',
      controlDate: '2026-08-05',
      result: 'годен',
      conclusionName: 'ЗНК-РК-1',
    })).toThrow('Сначала внесите годный результат ВИК до ТО')
    expect(canAddPreHeatTreatmentResult(row, 'РК')).toBe(false)
    expect(getPreHeatTreatmentResultBlockReason(row, 'РК')).toBe(
      'Сначала внесите годный результат ВИК до ТО.',
    )
  })

  it('allows a requested result once its stage prerequisites are complete', () => {
    const row = makeRow({
      preHeatTreatmentControls: [
        control(),
        control({ id: 2, method: 'РК', requestName: 'Заявка РК', result: 'ожидает НК' }),
      ],
    })

    expect(canAddPreHeatTreatmentResult(row, 'РК')).toBe(true)
  })

  it('blocks remaining results after one pre-heat-treatment method rejects the joint', () => {
    const row = makeRow({
      preHeatTreatmentControls: [
        control(),
        control({ id: 2, method: 'РК', result: 'вырез' }),
        control({ id: 3, method: 'ПВК', result: 'ожидает НК' }),
      ],
    })

    expect(getPreHeatTreatmentResultBlockReason(row, 'ПВК')).toBe(
      'НК до ТО уже имеет негодный результат: РК.',
    )
    expect(canAddPreHeatTreatmentResult(row, 'ПВК')).toBe(false)
  })

  it('builds a rejected result with an empty description for separate editing', () => {
    const row = makeRow({
      preHeatTreatmentControls: [control({ result: 'ожидает НК' })],
    })

    expect(buildPreHeatTreatmentResultWrite({
      row,
      methodCode: 'ВИК',
      controlDate: '2026-08-05',
      result: 'вырез',
      conclusionName: 'ЗНК-ВИК-1',
      defectDescription: 'Трещина',
    })).toEqual(expect.objectContaining({
      method: 'ВИК',
      result: 'вырез',
      conclusionDate: '2026-08-05',
      conclusionName: 'ЗНК-ВИК-1',
      defectDescription: null,
    }))
    expect(row.duplicateControls).toBeUndefined()
  })

  it('initializes the RK exposure scheme independently for the pre-TO result', () => {
    const row = makeRow({
      d1: 95,
      d2: 95,
      connectionType: 'С17',
      lnkDefectDescription: 'после ТО не менять',
      rkExposureConfirmedDiameter: 57,
      preHeatTreatmentControls: [
        control(),
        control({
          id: 2,
          method: 'РК',
          requestName: 'Заявка РК',
          result: 'ожидает НК',
          defectDescription: null,
          rkExposureConfirmedDiameter: null,
        }),
      ],
    })

    expect(buildPreHeatTreatmentResultWrite({
      row,
      methodCode: 'РК',
      controlDate: '2026-08-05',
      result: 'годен',
      conclusionName: 'ЗНК-РК-1',
      rkExposureTable: {
        fileName: 'Экспозиции',
        uploadedAt: '',
        entries: [{
          diameter: 89,
          options: [{ label: 'по 2 экспозициям', values: ['1', '2'], isDefault: true, note: '' }],
        }],
      },
    })).toEqual(expect.objectContaining({
      method: 'РК',
      result: 'годен',
      defectDescription: '1: ДНО\n2: ДНО',
      rkExposureConfirmedDiameter: 95,
    }))
    expect(row.lnkDefectDescription).toBe('после ТО не менять')
    expect(row.rkExposureConfirmedDiameter).toBe(57)
  })

  it('corrects an existing result while preserving its request identity', () => {
    const current = control()
    const row = makeRow({ pstoDate: null, preHeatTreatmentControls: [current] })

    expect(buildPreHeatTreatmentResultCorrectionWrite({
      row,
      control: current,
      controlDate: '2026-08-06',
      result: 'годен',
      conclusionName: 'ЗНК-ВИК-исправлено',
    })).toEqual(expect.objectContaining({
      id: 1,
      requestName: 'Заявка ВИК',
      requestDate: '2026-08-03',
      result: 'годен',
      conclusionDate: '2026-08-06',
      conclusionName: 'ЗНК-ВИК-исправлено',
      defectDescription: 'ДНО',
    }))
  })

  it('preserves a manual defect between rejected pre-TO results and replaces it for a good result', () => {
    const current = control({ result: 'ремонт', defectDescription: 'Несплошность 8 мм' })
    const row = makeRow({ pstoDate: null, preHeatTreatmentControls: [current] })

    const cut = buildPreHeatTreatmentResultCorrectionWrite({
      row,
      control: current,
      controlDate: '2026-08-06',
      result: 'вырез',
      conclusionName: 'ЗНК-ВИК-вырез',
    })
    expect(cut.defectDescription).toBe('Несплошность 8 мм')

    const good = buildPreHeatTreatmentResultCorrectionWrite({
      row,
      control: cut as typeof current,
      controlDate: '2026-08-06',
      result: 'годен',
      conclusionName: 'ЗНК-ВИК-годен',
    })
    expect(good.defectDescription).toBe('ДНО')
  })

  it('corrects a request without merging it into the primary stage', () => {
    const current = control()
    const row = makeRow({ preHeatTreatmentControls: [current] })

    expect(buildPreHeatTreatmentRequestCorrectionWrite({
      row,
      control: current,
      requestDate: '2026-08-02',
      requestName: 'Заявка ВИК до ТО исправлена',
    })).toEqual(expect.objectContaining({
      id: 1,
      requestDate: '2026-08-02',
      requestName: 'Заявка ВИК до ТО исправлена',
      conclusionName: current.conclusionName,
    }))
  })

  it('deletes a pre-TO request only after its result is removed', () => {
    const completed = control()
    const pending = control({ result: 'ожидает НК', conclusionDate: null, conclusionName: null })

    expect(getPreHeatTreatmentRequestRemovalBlockReason(
      makeRow({ pstoDate: null, pstoResult: null, preHeatTreatmentControls: [completed] }),
      completed,
    )).toContain('Сначала удалите результат')
    expect(getPreHeatTreatmentRequestRemovalBlockReason(
      makeRow({ pstoDate: null, pstoResult: null, preHeatTreatmentControls: [pending] }),
      pending,
    )).toBe('')
  })

  it('does not turn completed pre-TO control negative after PSTO has started', () => {
    const current = control()
    expect(() => buildPreHeatTreatmentResultCorrectionWrite({
      row: makeRow({ pstoRequest: 'Заявка ПСТО', preHeatTreatmentControls: [current] }),
      control: current,
      controlDate: '2026-08-06',
      result: 'вырез',
      conclusionName: 'ЗНК-ВИК-исправлено',
    })).toThrow('последующие этапы ПСТО/ТВМТ')
  })

  it('does not remove a pre-TO result from the middle of the chronology', () => {
    const vik = control()
    expect(getPreHeatTreatmentResultRemovalBlockReason(
      makeRow({ pstoRequest: 'Заявка ПСТО', preHeatTreatmentControls: [vik] }),
      vik,
    )).toContain('нельзя удалить')

    const rk = control({ id: 2, method: 'РК', result: 'годен' })
    expect(getPreHeatTreatmentResultRemovalBlockReason(
      makeRow({
        pstoDate: null,
        pstoResult: null,
        preHeatTreatmentControls: [vik, rk],
      }),
      vik,
    )).toContain('сохранены результаты: РК')
  })

  it('does not mistake a derived waiting label for a downstream PSTO stage', () => {
    const vik = control()
    const row = makeRow({
      pstoDate: null,
      pstoResult: 'ожидает заявку',
      preHeatTreatmentControls: [vik],
    })

    expect(getPreHeatTreatmentResultRemovalBlockReason(row, vik)).toBe('')
    expect(getPreHeatTreatmentRequestRemovalBlockReason(
      row,
      control({ result: 'ожидает НК', conclusionDate: null, conclusionName: null }),
    )).toBe('')
  })

  it('enforces ZВ-14 before heat treatment even when an old setting disabled it', () => {
    const pending = control({ result: 'ожидает НК', conclusionDate: null, conclusionName: null })
    const row = makeRow({ pstoDate: null, preHeatTreatmentControls: [pending] })
    const settings = {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      lnkResultDateAfterWeldDate: false,
      lnkResultRequestDateOrder: false,
    }

    expect(() => buildPreHeatTreatmentResultWrite({
      row,
      methodCode: 'ВИК',
      controlDate: 'дата уточняется',
      result: 'годен',
      conclusionName: 'ЗНК-ВИК-1',
      saveCheckSettings: settings,
    })).toThrow('Дата контроля НК до ТО')

    expect(() => buildPreHeatTreatmentResultWrite({
      row,
      methodCode: 'ВИК',
      controlDate: 'дата уточняется',
      result: 'годен',
      conclusionName: 'ЗНК-ВИК-1',
      saveCheckSettings: { ...settings, lnkResultControlDateFormat: false },
    })).toThrow('Дата контроля НК до ТО')
  })

  it('rejects a malformed pre-TO request date', () => {
    expect(() => buildPreHeatTreatmentRequestWrites({
      row: makeRow(),
      methodCodes: ['ВИК'],
      requestName: 'Заявка до ТО-1',
      requestDate: 'не дата',
    })).toThrow('корректную дату документа')
  })

  it('rejects pre-TO request and result dates before the system minimum', () => {
    expect(() => buildPreHeatTreatmentRequestWrites({
      row: makeRow(),
      methodCodes: ['ВИК'],
      requestName: 'Заявка до ТО-1',
      requestDate: '2023-12-31',
    })).toThrow('Дата заявки НК до ТО не может быть раньше 01.01.2024')

    expect(() => buildPreHeatTreatmentResultWrite({
      row: makeRow({
        preHeatTreatmentControls: [control({ result: 'ожидает НК' })],
      }),
      methodCode: 'ВИК',
      controlDate: '2023-12-31',
      result: 'годен',
      conclusionName: 'ЗНК-ВИК-1',
    })).toThrow('Дата контроля НК до ТО не может быть раньше 01.01.2024')
  })
})

function makeRow(overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 1,
    joint: 'F1',
    weldDate: '2026-08-01',
    pstoRequired: 'да',
    pstoDate: '2026-08-10',
    hasVik: 'да',
    hasRk: 'да',
    hasUzk: 'да',
    hasPvk: 'да',
    ...overrides,
  } as WeldRow
}

function control(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    weldJointId: 1,
    method: 'ВИК',
    requestName: 'Заявка ВИК',
    requestDate: '2026-08-03',
    result: 'годен',
    conclusionDate: '2026-08-04',
    conclusionName: 'ЗНК-ВИК-1',
    ...overrides,
  }
}
