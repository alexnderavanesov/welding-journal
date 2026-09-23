import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { assertNoNewLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import {
  buildSystemDocumentDateChangePlan,
  buildSystemDocumentDateChangePreview,
} from '@/lib/system-document-date-change'

describe('system document date change', () => {
  it('changes every matching position of a multi-row document and preserves its full name including the original date', () => {
    const sourceRows = [
      row(1, {
        vikRequest: 'Заявка-09.08.2026-007',
        vikRequestDate: '2026-08-09',
        rkRequest: 'Заявка-09.08.2026-007',
        rkRequestDate: '2026-08-09',
      }),
      row(2, {
        uzkRequest: 'Заявка-09.08.2026-007',
        uzkRequestDate: '2026-08-09',
      }),
      row(3, {
        vikRequest: 'Заявка-09.08.2026-007',
        vikRequestDate: '2026-08-08',
      }),
    ]
    const plan = buildSystemDocumentDateChangePlan({
      reference: {
        type: 'lnkRequest',
        title: 'Заявка-09.08.2026-007',
        date: '2026-08-09',
      },
      nextDate: '2026-08-10',
      rows: sourceRows,
    })

    expect(plan).toMatchObject({
      previousTitle: 'Заявка-09.08.2026-007',
      nextTitle: 'Заявка-09.08.2026-007',
      previousDate: '2026-08-09',
      nextDate: '2026-08-10',
      rowCount: 2,
      positionCount: 3,
      directRowIds: [1, 2],
      touchedRowIds: [1, 2],
    })
    expect(plan.rows[0]).toMatchObject({
      vikRequest: 'Заявка-09.08.2026-007',
      vikRequestDate: '2026-08-10',
      rkRequest: 'Заявка-09.08.2026-007',
      rkRequestDate: '2026-08-10',
    })
    expect(plan.rows[1]).toMatchObject({
      uzkRequest: 'Заявка-09.08.2026-007',
      uzkRequestDate: '2026-08-10',
    })
    expect(plan.rows[2]).toMatchObject({
      vikRequest: 'Заявка-09.08.2026-007',
      vikRequestDate: '2026-08-08',
    })
    expect(sourceRows[0]).toMatchObject({
      vikRequest: 'Заявка-09.08.2026-007',
      vikRequestDate: '2026-08-09',
    })
  })

  it('keeps a user-entered document name unchanged', () => {
    const preview = buildSystemDocumentDateChangePreview({
      reference: {
        type: 'lnkConclusion',
        title: 'Заключение заказчика ABC',
        date: '2026-08-09',
        methodCode: 'ВИК',
      },
      nextDate: '2026-08-10',
      rows: [row(1, {
        vikConclusion: 'Заключение заказчика ABC',
        vikConclusionDate: '2026-08-09',
      })],
    })

    expect(preview).toMatchObject({
      nextTitle: 'Заключение заказчика ABC',
      rowCount: 1,
      positionCount: 1,
    })
    expect(preview?.rows[0]).toMatchObject({
      vikConclusion: 'Заключение заказчика ABC',
      vikConclusionDate: '2026-08-10',
    })
  })

  it('repairs a named document whose current date is missing', () => {
    const plan = buildSystemDocumentDateChangePlan({
      reference: {
        type: 'lnkRequest',
        title: 'Заявка без даты',
        date: '',
      },
      nextDate: '2026-08-10',
      rows: [row(1, {
        vikRequest: 'Заявка без даты',
        vikRequestDate: null,
      })],
    })

    expect(plan).toMatchObject({
      previousDate: '',
      nextDate: '2026-08-10',
      nextTitle: 'Заявка без даты',
      rowCount: 1,
      positionCount: 1,
    })
    expect(plan.rows[0]).toMatchObject({
      vikRequest: 'Заявка без даты',
      vikRequestDate: '2026-08-10',
    })
  })

  it('previews every exact cycle position without replacing the real row shape', () => {
    const preview = buildSystemDocumentDateChangePreview({
      reference: {
        type: 'pstoConclusion',
        title: 'Общая диаграмма ПСТО',
        date: '2026-08-09',
        sourceKind: 'pstoCycle',
        cycleSequences: [1, 2],
      },
      nextDate: '2026-08-10',
      rows: [row(1, {
        heatTreatmentDiagram: 'Общая диаграмма ПСТО',
        pstoDate: '2026-08-09',
        pstoRepeatCycles: [{
          id: 102,
          weldJointId: 1,
          sequence: 2,
          heatTreatmentDiagram: 'Общая диаграмма ПСТО',
          pstoDate: '2026-08-09',
        }],
      })],
      sourcePositions: [
        { kind: 'pstoCycle', weldJointId: 1, relationId: 1, sequence: 1 },
        { kind: 'pstoCycle', weldJointId: 1, relationId: 102, sequence: 2 },
      ],
    })

    expect(preview).toMatchObject({ rowCount: 1, positionCount: 2 })
    expect(preview?.rows[0]).toMatchObject({
      heatTreatmentDiagram: 'Общая диаграмма ПСТО',
      pstoDate: '2026-08-10',
      pstoRepeatCycles: [expect.objectContaining({
        id: 102,
        heatTreatmentDiagram: 'Общая диаграмма ПСТО',
        pstoDate: '2026-08-10',
      })],
    })
  })

  it('updates an exact pre-TO source relation instead of primary LNK fields', () => {
    const source = row(1, {
      vikRequest: 'Основная заявка',
      vikRequestDate: '2026-08-05',
      preHeatTreatmentControls: [{
        id: 101,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        requestDate: '2026-08-02',
      }],
    })
    const plan = buildSystemDocumentDateChangePlan({
      reference: {
        type: 'lnkRequest',
        title: 'Заявка ВИК до ТО',
        date: '2026-08-02',
        methodCode: 'ВИК',
        sourceKind: 'beforeHeatTreatment',
      },
      nextDate: '2026-08-03',
      rows: [source],
      sourcePositions: [{
        kind: 'beforeHeatTreatment',
        weldJointId: 1,
        relationId: 101,
        methodCode: 'ВИК',
      }],
    })

    expect(plan.directRowIds).toEqual([])
    expect(plan.preHeatTreatmentControls).toEqual([
      expect.objectContaining({ id: 101, requestName: 'Заявка ВИК до ТО', requestDate: '2026-08-03' }),
    ])
    expect(plan.rows[0]).toMatchObject({
      vikRequest: 'Основная заявка',
      vikRequestDate: '2026-08-05',
      preHeatTreatmentControls: [expect.objectContaining({ id: 101, requestDate: '2026-08-03' })],
    })
    expect(source.preHeatTreatmentControls?.[0].requestDate).toBe('2026-08-02')
  })

  it('updates the exact repeat PSTO cycle without touching the primary cycle', () => {
    const source = row(1, {
      pstoDate: '2026-08-03',
      heatTreatmentDiagram: 'Основная диаграмма',
      pstoRepeatCycles: [{
        id: 202,
        weldJointId: 1,
        sequence: 2,
        pstoDate: '2026-08-09',
        heatTreatmentDiagram: 'Диаграмма повтор 2',
      }],
    })
    const plan = buildSystemDocumentDateChangePlan({
      reference: {
        type: 'pstoConclusion',
        title: 'Диаграмма повтор 2',
        date: '2026-08-09',
        sourceKind: 'pstoCycle',
        cycleSequences: [2],
      },
      nextDate: '2026-08-10',
      rows: [source],
      sourcePositions: [{
        kind: 'pstoCycle',
        weldJointId: 1,
        relationId: 202,
        sequence: 2,
      }],
    })

    expect(plan.directRowIds).toEqual([])
    expect(plan.pstoRepeatCycles).toEqual([
      expect.objectContaining({ id: 202, pstoDate: '2026-08-10', heatTreatmentDiagram: 'Диаграмма повтор 2' }),
    ])
    expect(plan.rows[0]).toMatchObject({
      pstoDate: '2026-08-03',
      heatTreatmentDiagram: 'Основная диаграмма',
      pstoRepeatCycles: [expect.objectContaining({ id: 202, pstoDate: '2026-08-10' })],
    })
  })

  it('rejects stale source metadata before producing any persistence plan', () => {
    expect(() => buildSystemDocumentDateChangePlan({
      reference: {
        type: 'lnkRequest',
        title: 'Заявка ВИК до ТО',
        date: '2026-08-02',
        methodCode: 'ВИК',
        sourceKind: 'beforeHeatTreatment',
      },
      nextDate: '2026-08-03',
      rows: [row(1)],
      sourcePositions: [{
        kind: 'beforeHeatTreatment',
        weldJointId: 1,
        relationId: 999,
        methodCode: 'ВИК',
      }],
    })).toThrow('Ничего не сохранено')
  })

  it('lets the server revalidation reject a newly introduced contradiction before persistence', () => {
    const currentRows = [row(5, {
      weldDate: '2026-08-10',
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО',
      pstoRequestDate: '2026-08-20',
      pstoResult: 'проведено',
      pstoDate: '2026-08-29',
      heatTreatmentDiagram: 'Диаграмма ПСТО',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtRequestDate: '2026-08-29',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-30',
      tvmtConclusion: 'Заключение ТВМТ',
      hasVik: 'да',
      vikRequest: 'Заявка-30.08.2026-007',
      vikRequestDate: '2026-08-30',
    })]
    const plan = buildSystemDocumentDateChangePlan({
      reference: {
        type: 'lnkRequest',
        title: 'Заявка-30.08.2026-007',
        date: '2026-08-30',
        methodCode: 'ВИК',
      },
      nextDate: '2026-08-09',
      rows: currentRows,
    })

    expect(() => assertNoNewLnkChronologyIssues(
      plan.rows,
      currentRows,
      DEFAULT_SAVE_CHECK_SETTINGS,
    )).toThrow('раньше даты сварки')
    expect(currentRows[0].vikRequestDate).toBe('2026-08-30')
  })
})

function row(id: number, overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id,
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'L-1',
    joint: `F${id}`,
    rowVersion: `v${id}`,
    ...overrides,
  } as WeldRow
}
