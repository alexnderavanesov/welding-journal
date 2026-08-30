import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import {
  buildClearedPrimaryLnkStageRows,
  buildPreHeatTreatmentToPrimaryTransfer,
  buildPrimaryToPreHeatTreatmentTransfer,
} from '@/lib/lnk-stage-transfer'

describe('LNK stage transfer', () => {
  it('moves only the selected primary method to pre-TO and leaves duplicates and unrelated methods intact', () => {
    const duplicateControls: DuplicateControlRecord[] = [{
      id: 51,
      weldJointId: 1,
      method: 'РК',
      result: 'ремонт',
      controlDate: '2026-08-10',
      conclusion: 'Дубль-РК-1',
      conclusionDate: '2026-08-10',
    }]
    const row = makeRow({
      vikRequest: 'Заявка-1',
      vikRequestDate: '2026-08-01',
      vikResult: 'годен',
      vikConclusionDate: '2026-08-02',
      vikConclusion: 'ЗНК-ВИК-1',
      rfaRequest: 'РФА-1',
      rfaResult: 'годен',
      duplicateControls,
    })

    const transfer = buildPrimaryToPreHeatTreatmentTransfer({
      rows: [row],
      positions: [{ rowId: 1, methodCode: 'ВИК' }],
    })

    expect(transfer.controls).toMatchObject([{
      weldJointId: 1,
      method: 'ВИК',
      requestName: 'Заявка-1',
      result: 'годен',
      conclusionName: 'ЗНК-ВИК-1',
    }])
    expect(transfer.rows[0]).toMatchObject({
      vikRequest: null,
      vikResult: null,
      vikConclusion: null,
      rfaRequest: 'РФА-1',
      rfaResult: 'годен',
    })
    expect(transfer.rows[0]?.duplicateControls).toBe(duplicateControls)
  })

  it('moves a complete pre-TO control to an empty primary stage without touching duplicates', () => {
    const duplicateControls: DuplicateControlRecord[] = [{
      id: 8,
      weldJointId: 1,
      method: 'ВИК',
      result: 'годен',
      controlDate: '2026-08-01',
      conclusion: 'Дубль-ВИК-1',
      conclusionDate: '2026-08-01',
    }]
    const row = makeRow({ duplicateControls })
    const control = {
      id: 10,
      weldJointId: 1,
      method: 'РК',
      requestName: 'Заявка-РК-до',
      requestDate: '2026-08-01',
      result: 'годен',
      conclusionDate: '2026-08-02',
      conclusionName: 'ЗНК-РК-до',
      defectDescription: '0-100: ДНО\n100-0: ДНО',
      rkExposureConfirmedDiameter: 57,
    }

    const [next] = buildPreHeatTreatmentToPrimaryTransfer({ rows: [row], controls: [control] })

    expect(next).toMatchObject({
      rkRequest: 'Заявка-РК-до',
      rkRequestDate: '2026-08-01',
      rkResult: 'годен',
      rkConclusionDate: '2026-08-02',
      rkConclusion: 'ЗНК-РК-до',
      lnkDefectDescription: '0-100: ДНО\n100-0: ДНО',
      rkExposureConfirmedDiameter: 57,
    })
    expect(next.duplicateControls).toBe(duplicateControls)
  })

  it('keeps a request-only position visibly pending after moving it to pre-TO', () => {
    const transfer = buildPrimaryToPreHeatTreatmentTransfer({
      rows: [makeRow({
        vikRequest: 'Заявка-ВИК-1',
        vikRequestDate: '2026-08-01',
      })],
      positions: [{ rowId: 1, methodCode: 'ВИК' }],
    })

    expect(transfer.controls[0]).toMatchObject({
      requestName: 'Заявка-ВИК-1',
      result: 'ожидает НК',
    })
  })

  it('does not treat a derived waiting label as occupied primary-stage data', () => {
    const row = makeRow({ vikResult: 'ожидает заявку' })
    expect(() => buildPrimaryToPreHeatTreatmentTransfer({
      rows: [row],
      positions: [{ rowId: 1, methodCode: 'ВИК' }],
    })).toThrow('основной комплект ВИК уже пуст')

    const [next] = buildPreHeatTreatmentToPrimaryTransfer({
      rows: [row],
      controls: [{
        id: 10,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка до ТО',
      }],
    })
    expect(next?.vikRequest).toBe('Заявка до ТО')
  })

  it('preserves a good RK exposure scheme when moving it to pre-TO', () => {
    const transfer = buildPrimaryToPreHeatTreatmentTransfer({
      rows: [makeRow({
        rkRequest: 'Заявка-РК-1',
        rkRequestDate: '2026-08-01',
        rkResult: 'годен',
        rkConclusionDate: '2026-08-02',
        rkConclusion: 'ЗНК-РК-1',
        lnkDefectDescription: '0-100: ДНО\n100-0: ДНО',
        rkExposureConfirmedDiameter: 57,
      })],
      positions: [{ rowId: 1, methodCode: 'РК' }],
    })

    expect(transfer.controls[0]).toMatchObject({
      method: 'РК',
      defectDescription: '0-100: ДНО\n100-0: ДНО',
      rkExposureConfirmedDiameter: 57,
    })
    expect(transfer.rows[0]?.lnkDefectDescription).toBeNull()
    expect(transfer.rows[0]?.rkExposureConfirmedDiameter).toBeNull()
  })

  it('moves an RK-only metadata trace to pre-TO instead of leaving hidden primary data', () => {
    const transfer = buildPrimaryToPreHeatTreatmentTransfer({
      rows: [makeRow({
        lnkDefectDescription: '0-100: ДНО',
        rkExposureConfirmedDiameter: 57,
      })],
      positions: [{ rowId: 1, methodCode: 'РК' }],
    })

    expect(transfer.controls[0]).toMatchObject({
      method: 'РК',
      defectDescription: '0-100: ДНО',
      rkExposureConfirmedDiameter: 57,
    })
    expect(transfer.rows[0]?.lnkDefectDescription).toBeNull()
    expect(transfer.rows[0]?.rkExposureConfirmedDiameter).toBeNull()
  })

  it('deletes only selected primary stage fields and preserves assignments, duplicates, BoQ and KS3', () => {
    const duplicateControls = [{
      id: 9,
      weldJointId: 1,
      method: 'ВИК' as const,
      result: 'годен' as const,
      controlDate: '2026-08-01',
      conclusion: 'Дубль-1',
      conclusionDate: '2026-08-01',
    }]
    const [next] = buildClearedPrimaryLnkStageRows({
      rows: [makeRow({
        hasVik: 'да',
        vikRequest: 'Заявка-1',
        vikResult: 'годен',
        vikConclusion: 'ЗНК-1',
        vikBoq: 'BoQ-1',
        vikKs3: 'КС3-1',
        duplicateControls,
      })],
      positions: [{ rowId: 1, methodCode: 'ВИК' }],
    })

    expect(next).toMatchObject({
      hasVik: 'да',
      vikRequest: null,
      vikResult: null,
      vikConclusion: null,
      vikBoq: 'BoQ-1',
      vikKs3: 'КС3-1',
    })
    expect(next?.duplicateControls).toBe(duplicateControls)
  })

  it('refuses to overwrite an occupied destination stage', () => {
    const row = makeRow({ rkRequest: 'Уже есть' })
    expect(() => buildPreHeatTreatmentToPrimaryTransfer({
      rows: [row],
      controls: [{
        id: 10,
        weldJointId: 1,
        method: 'РК',
        requestName: 'Другая заявка',
      }],
    })).toThrow('основной комплект РК уже заполнен')
  })

  it('treats an existing RK exposure scheme as occupied primary data', () => {
    const row = makeRow({ lnkDefectDescription: '0-100: ДНО' })
    expect(() => buildPreHeatTreatmentToPrimaryTransfer({
      rows: [row],
      controls: [{
        id: 10,
        weldJointId: 1,
        method: 'РК',
        requestName: 'Заявка до ТО',
      }],
    })).toThrow('основной комплект РК уже заполнен')
  })
})

function makeRow(overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 1,
    projectTitle: 'Проект',
    subtitleCode: 'Шифр',
    line: 'Линия',
    joint: 'F1',
    pstoRequired: 'да',
    ...overrides,
  }
}
