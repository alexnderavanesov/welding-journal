import { describe, expect, it, vi } from 'vitest'

import {
  applyGeneratedDocumentFields,
  attachSystemDocumentIds,
} from '@/server/generated-document-row-fields'

describe('generated document row fields', () => {
  it('attaches each document type independently to the same weld', () => {
    expect(
      applyGeneratedDocumentFields(
        [{
          id: 10,
          joint: 'S1',
          rkRequest: 'Заявка НК №7',
          rkRequestDate: '2026-08-10',
        }],
        [
          { weldJointId: 10, documentId: 1, type: 'weldingJournal', title: 'ЖСР №1' },
          { weldJointId: 10, documentId: 2, type: 'checklist', title: 'Чек-лист №7' },
          { weldJointId: 10, documentId: 3, type: 'zni', title: 'ЗНИ №4' },
          { weldJointId: 10, documentId: 5, type: 'layeredVikEdges', title: 'ВИК - кромки - S1 - 10.08.2026' },
          { weldJointId: 10, documentId: 6, type: 'layeredVikLayers', title: 'ВИК - слои - S1 - 10.08.2026' },
          {
            weldJointId: 10,
            documentId: 4,
            type: 'system:lnkRequest',
            title: 'Заявка НК №7',
            periodFrom: '2026-08-10',
          },
        ],
      ),
    ).toEqual([
      {
        id: 10,
        joint: 'S1',
        rkRequest: 'Заявка НК №7',
        rkRequestDate: '2026-08-10',
        jsrDocument: 'ЖСР №1',
        jsrDocumentId: 1,
        checklistDocument: 'Чек-лист №7',
        checklistDocumentId: 2,
        zniDocument: 'ЗНИ №4',
        zniDocumentId: 3,
        layeredVikEdgesDocument: 'ВИК - кромки - S1 - 10.08.2026',
        layeredVikEdgesDocumentId: 5,
        layeredVikLayersDocument: 'ВИК - слои - S1 - 10.08.2026',
        layeredVikLayersDocumentId: 6,
        layeredVikDocuments: 'Кромки: ВИК - кромки - S1 - 10.08.2026\nСлои: ВИК - слои - S1 - 10.08.2026',
        systemDocumentIds: { rkRequest: 4 },
      },
    ])
  })

  it('keeps primary and pre-TO document ids separate even when their names and dates match', () => {
    expect(applyGeneratedDocumentFields(
      [{
        id: 11,
        vikRequest: 'Заявка ВИК',
        vikRequestDate: '2026-09-01',
        preVikRequest: 'Заявка ВИК',
        preVikRequestDate: '2026-09-01',
      }],
      [
        {
          weldJointId: 11,
          documentId: 7,
          type: 'system:lnkRequest',
          title: 'Заявка ВИК',
          periodFrom: '2026-09-01',
          sourceMetadata: null,
        },
        {
          weldJointId: 11,
          documentId: 8,
          type: 'system:lnkRequest',
          title: 'Заявка ВИК',
          periodFrom: '2026-09-01',
          sourceMetadata: JSON.stringify({ sourceKind: 'beforeHeatTreatment' }),
        },
      ],
    )[0]?.systemDocumentIds).toMatchObject({
      vikRequest: 7,
      preVikRequest: 8,
    })
  })

  it('attaches document ids from the current repeated PSTO cycle instead of the primary cycle', () => {
    const metadata = (sourceKind: 'pstoCycle' | 'pstoRepeat', sequence: number) =>
      JSON.stringify({ sourceKind, cycleSequences: [sequence] })
    const result = applyGeneratedDocumentFields(
      [{
        id: 11,
        pstoRequest: 'ПСТО основной',
        pstoRequestDate: '2026-09-01',
        heatTreatmentDiagram: 'Диаграмма основная',
        pstoDate: '2026-09-02',
        tvmtRequest: 'ТВМТ основной',
        tvmtRequestDate: '2026-09-03',
        tvmtConclusion: 'Заключение ТВМТ основное',
        tvmtConclusionDate: '2026-09-04',
        pstoRepeatCycles: [{
          id: 91,
          weldJointId: 11,
          sequence: 2,
          pstoRequest: 'ПСТО повтор 2',
          pstoRequestDate: '2026-09-05',
          heatTreatmentDiagram: 'Диаграмма повтор 2',
          pstoDate: '2026-09-06',
          pstoResult: 'годен',
          tvmtRequest: 'ТВМТ повтор 2',
          tvmtRequestDate: '2026-09-07',
          tvmtConclusion: 'Заключение ТВМТ повтор 2',
          tvmtConclusionDate: '2026-09-08',
          tvmtResult: 'годен',
        }],
      }],
      [
        { weldJointId: 11, documentId: 201, type: 'system:pstoRequest', title: 'ПСТО основной', periodFrom: '2026-09-01', sourceMetadata: metadata('pstoCycle', 1) },
        { weldJointId: 11, documentId: 202, type: 'system:pstoRequest', title: 'ПСТО повтор 2', periodFrom: '2026-09-05', sourceMetadata: metadata('pstoCycle', 2) },
        { weldJointId: 11, documentId: 203, type: 'system:pstoConclusion', title: 'Диаграмма основная', periodFrom: '2026-09-02', sourceMetadata: metadata('pstoCycle', 1) },
        { weldJointId: 11, documentId: 204, type: 'system:pstoConclusion', title: 'Диаграмма повтор 2', periodFrom: '2026-09-06', sourceMetadata: metadata('pstoCycle', 2) },
        { weldJointId: 11, documentId: 205, type: 'system:tvmtRequest', title: 'ТВМТ основной', periodFrom: '2026-09-03', sourceMetadata: metadata('pstoCycle', 1) },
        { weldJointId: 11, documentId: 206, type: 'system:tvmtRequest', title: 'ТВМТ повтор 2', periodFrom: '2026-09-07', sourceMetadata: metadata('pstoCycle', 2) },
        { weldJointId: 11, documentId: 207, type: 'system:tvmtConclusion', title: 'Заключение ТВМТ основное', periodFrom: '2026-09-04', sourceMetadata: metadata('pstoCycle', 1) },
        { weldJointId: 11, documentId: 208, type: 'system:tvmtConclusion', title: 'Заключение ТВМТ повтор 2', periodFrom: '2026-09-08', sourceMetadata: metadata('pstoCycle', 2) },
      ],
    )[0]

    expect(result?.systemDocumentIds).toMatchObject({
      pstoRequest: 202,
      heatTreatmentDiagram: 204,
      tvmtRequest: 206,
      tvmtConclusion: 208,
    })
  })

  it('keeps legacy documents without cycle metadata available for the primary PSTO cycle', () => {
    const result = applyGeneratedDocumentFields(
      [{
        id: 12,
        pstoRequest: 'ПСТО основной',
        pstoRequestDate: '2026-09-01',
        heatTreatmentDiagram: 'Диаграмма основная',
        pstoDate: '2026-09-02',
        tvmtRequest: 'ТВМТ основной',
        tvmtRequestDate: '2026-09-03',
        tvmtConclusion: 'Заключение ТВМТ основное',
        tvmtConclusionDate: '2026-09-04',
      }],
      [
        { weldJointId: 12, documentId: 301, type: 'system:pstoRequest', title: 'ПСТО основной', periodFrom: '2026-09-01', sourceMetadata: null },
        { weldJointId: 12, documentId: 302, type: 'system:pstoConclusion', title: 'Диаграмма основная', periodFrom: '2026-09-02', sourceMetadata: null },
        { weldJointId: 12, documentId: 303, type: 'system:tvmtRequest', title: 'ТВМТ основной', periodFrom: '2026-09-03', sourceMetadata: null },
        { weldJointId: 12, documentId: 304, type: 'system:tvmtConclusion', title: 'Заключение ТВМТ основное', periodFrom: '2026-09-04', sourceMetadata: null },
      ],
    )[0]

    expect(result?.systemDocumentIds).toMatchObject({
      pstoRequest: 301,
      heatTreatmentDiagram: 302,
      tvmtRequest: 303,
      tvmtConclusion: 304,
    })
  })

  it.each([
    [2, 1],
    [100, 1],
    [1_200, 2],
  ])('loads system document ids for %i rows with %i bounded queries', async (rowCount, queryCount) => {
    const where = vi.fn().mockResolvedValue([])
    const innerJoin = vi.fn(() => ({ where }))
    const from = vi.fn(() => ({ innerJoin }))
    const select = vi.fn(() => ({ from }))

    await attachSystemDocumentIds(
      Array.from({ length: rowCount }, (_, index) => ({ id: index + 1 })),
      { select } as never,
    )

    expect(select).toHaveBeenCalledTimes(queryCount)
    expect(where).toHaveBeenCalledTimes(queryCount)
  })
})
