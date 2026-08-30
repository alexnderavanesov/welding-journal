import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  buildPreHeatTreatmentSystemDocumentRow,
  buildPrimaryPstoSystemDocumentRow,
  buildPstoRepeatSystemDocumentRow,
} from '@/lib/system-document-virtual-row'
import {
  buildSystemDocumentSummaries,
  getSystemDocumentReferenceForField,
} from '@/lib/system-document-types'

describe('system document virtual rows', () => {
  it('keeps pre-heat-treatment documents separate from primary LNK fields', () => {
    const row = buildPreHeatTreatmentSystemDocumentRow({
      id: 10,
      joint: 'F10',
      vikRequest: 'После ТО',
      vikResult: 'годен',
      rkRequest: 'После ТО РК',
      duplicateControls: [{
        id: 1,
        weldJointId: 10,
        method: 'РК',
        result: 'годен',
        controlDate: '',
        conclusion: '',
        conclusionDate: '',
      }],
    }, [{
      id: 21,
      weldJointId: 10,
      method: 'ВИК',
      requestName: 'До ТО',
      requestDate: '2026-08-01',
      result: 'годен',
      conclusionDate: '2026-08-02',
      conclusionName: 'ЗНК-ВИК-до-ТО',
    }])

    expect(row.vikRequest).toBe('До ТО')
    expect(row.vikConclusion).toBe('ЗНК-ВИК-до-ТО')
    expect(row.rkRequest).toBeUndefined()
    expect(row.duplicateControls).toEqual([
      {
        id: 1,
        weldJointId: 10,
        method: 'РК',
        result: 'годен',
        controlDate: '',
        conclusion: '',
        conclusionDate: '',
      },
    ])
  })

  it('keeps RK exposure data when another pre-heat-treatment method follows RK', () => {
    const row = buildPreHeatTreatmentSystemDocumentRow({
      id: 10,
      joint: 'F10',
    }, [
      {
        id: 21,
        weldJointId: 10,
        method: 'РК',
        requestName: 'Заявка до ТО',
        requestDate: '2026-08-01',
        result: 'годен',
        conclusionDate: '2026-08-02',
        conclusionName: 'ЗНК-РК-до-ТО',
        defectDescription: '1.2 | ДНО',
        rkExposureConfirmedDiameter: 57,
      },
      {
        id: 22,
        weldJointId: 10,
        method: 'УЗК',
        requestName: 'Заявка до ТО',
        requestDate: '2026-08-01',
        result: 'годен',
        conclusionDate: '2026-08-02',
        conclusionName: 'ЗНК-УЗК-до-ТО',
      },
    ])

    expect(row.lnkDefectDescription).toBe('1.2 | ДНО')
    expect(row.rkExposureConfirmedDiameter).toBe(57)
  })

  it('shows only the selected repeat cycle in PSTO and TVMT template fields', () => {
    const selectedCycle = {
      id: 31,
      weldJointId: 10,
      sequence: 2,
      pstoRequest: 'Повторная ПСТО',
      pstoRequestDate: '2026-08-03',
      heatTreatmentDiagram: 'Повторная диаграмма',
      pstoDate: '2026-08-04',
      pstoResult: 'проведено',
      tvmtRequest: 'Повторная ТВМТ',
      tvmtResult: 'ожидает НК',
    }
    const row = buildPstoRepeatSystemDocumentRow({
      id: 10,
      pstoRequest: 'Первая ПСТО',
      heatTreatmentDiagram: 'Первая диаграмма',
      tvmtRequest: 'Первая ТВМТ',
      vikRequest: 'Основная заявка ВИК',
      pstoRepeatCycles: [
        selectedCycle,
        {
          ...selectedCycle,
          id: 32,
          sequence: 3,
          pstoRequest: 'Самая новая ПСТО',
          tvmtRequest: 'Самая новая ТВМТ',
        },
      ],
    }, selectedCycle)

    expect(row.pstoRequest).toBe('Повторная ПСТО')
    expect(row.heatTreatmentDiagram).toBe('Повторная диаграмма')
    expect(row.tvmtRequest).toBe('Повторная ТВМТ')
    expect(row.vikRequest).toBeUndefined()
    expect(row.pstoRepeatCycles).toEqual([selectedCycle])
    expect(getSystemDocumentReferenceForField(row, 'tvmtRequest')).toMatchObject({
      title: 'Повторная ТВМТ',
      sourceKind: 'pstoCycle',
      cycleSequences: [2],
    })
  })

  it('isolates primary PSTO and TVMT fields from ordinary LNK documents', () => {
    const row = buildPrimaryPstoSystemDocumentRow({
      id: 10,
      pstoRequest: 'Заявка ПСТО',
      pstoRequestDate: '2026-08-20',
      tvmtRequest: 'Общее пользовательское имя',
      tvmtRequestDate: '2026-08-21',
      vikRequest: 'Общее пользовательское имя',
      vikRequestDate: '2026-08-21',
      pstoRepeatCycles: [{ id: 31, weldJointId: 10, sequence: 2 }],
    } as WeldRow)

    expect(row.vikRequest).toBeUndefined()
    expect(row.tvmtRequest).toBe('Общее пользовательское имя')
    expect(row.pstoRepeatCycles).toEqual([])
    expect(buildSystemDocumentSummaries([row], 'lnkRequest')).toMatchObject([{
      title: 'Общее пользовательское имя',
      methodCodes: ['ТВМТ'],
    }])
  })
})
