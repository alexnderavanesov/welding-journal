import { describe, expect, it, vi } from 'vitest'

import {
  buildGeneratedDocumentBatchAssignmentPlans,
  buildRemoteDocumentHistoryResult,
  normalizeGeneratedDocumentHistoryRequest,
  normalizeDocumentHistoryLimit,
  normalizeSaveGeneratedDocumentBatch,
  persistGeneratedDocumentBatchRecordsInTransaction,
  refreshStaleGeneratedDocumentsInTransaction,
  type SaveGeneratedDocumentInput,
} from '@/server/generated-documents'
import { buildWeldColumnValueFilter } from '@/lib/weld-table-filtering'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import type { GeneratedDocumentsTransaction } from '@/server/generated-document-number-sequence'

describe('generated document batch', () => {
  it('normalizes a disjoint series of documents of one type', () => {
    const result = normalizeSaveGeneratedDocumentBatch([
      input('ЖСР 1', [1, 2]),
      input('ЖСР 2', [3, 4]),
    ])

    expect(result).toHaveLength(2)
    expect(result[0].weldJointIds).toEqual([1, 2])
    expect(result[1].weldJointIds).toEqual([3, 4])
  })

  it('rejects a series when one weld is assigned to two documents', () => {
    expect(() =>
      normalizeSaveGeneratedDocumentBatch([
        input('ЖСР 1', [1, 2]),
        input('ЖСР 2', [2, 3]),
      ]),
    ).toThrow('Стык с ID 2 одновременно попал в несколько документов.')
  })

  it('rejects mixed document types in one transaction', () => {
    expect(() =>
      normalizeSaveGeneratedDocumentBatch([
        input('ЖСР', [1]),
        { ...input('Чек-лист', [2]), type: 'checklist' },
      ]),
    ).toThrow('За одну операцию можно сформировать документы только одного типа.')
  })

  it('accepts ZNI as an independent user document type', () => {
    const result = normalizeSaveGeneratedDocumentBatch([
      { ...input('ЗНИ №1', [7, 8]), type: 'zni' },
    ])

    expect(result).toEqual([
      expect.objectContaining({
        type: 'zni',
        title: 'ЗНИ №1',
        weldJointIds: [7, 8],
      }),
    ])
  })

  it('rejects manual creation of automatic layered conclusions', () => {
    expect(() => normalizeSaveGeneratedDocumentBatch([
      { ...input('ВИК - кромки - F1', [1]), type: 'layeredVikEdges' },
    ])).toThrow('Неизвестный тип документа.')
  })

  it('preserves the sequential reassignment result while planning the whole batch in memory', () => {
    const plans = buildGeneratedDocumentBatchAssignmentPlans({
      selectedWeldJointIdGroups: [[10], [11]],
      existingAssignments: [
        { documentId: 7, weldJointId: 10 },
        { documentId: 7, weldJointId: 11 },
      ],
      documentAssignmentCounts: new Map([[7, 2]]),
    })

    expect(plans).toEqual([
      { targetDocumentId: null, affectedDocumentIds: [7] },
      { targetDocumentId: 7, affectedDocumentIds: [7] },
    ])
  })
})

describe('generated document batch database load', () => {
  it.each([2, 100])('updates %i existing documents with one database operation', async (documentCount) => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const tx = { execute } as unknown as GeneratedDocumentsTransaction
    const records = Array.from({ length: documentCount }, (_, index) => batchRecord(index, index + 1))

    const resolvedIds = await persistGeneratedDocumentBatchRecordsInTransaction(tx, records)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(resolvedIds.size).toBe(documentCount)
    expect(resolvedIds.get(documentCount - 1)).toBe(documentCount)
  })

  it.each([2, 100])('inserts %i new documents with one database operation', async (documentCount) => {
    const returning = vi.fn()
    const values = vi.fn((insertedRecords: Array<{ documentNumber: number | null }>) => {
      returning.mockResolvedValueOnce(insertedRecords
        .map((record) => ({ id: 10_000 + Number(record.documentNumber), documentNumber: record.documentNumber }))
        .reverse())
      return { returning }
    })
    const insert = vi.fn(() => ({ values }))
    const tx = { insert } as unknown as GeneratedDocumentsTransaction
    const records = Array.from({ length: documentCount }, (_, index) => batchRecord(index, null))

    const resolvedIds = await persistGeneratedDocumentBatchRecordsInTransaction(tx, records)

    expect(insert).toHaveBeenCalledTimes(1)
    expect(values).toHaveBeenCalledTimes(1)
    expect(resolvedIds.size).toBe(documentCount)
    expect(resolvedIds.get(documentCount - 1)).toBe(10_000 + documentCount)
  })
})

describe('generated document history', () => {
  const documents = [
    { id: 1, title: 'Документ 1', projects: ['П1'], subtitles: ['Ш1'] },
    { id: 2, title: 'Документ 2', projects: ['П2'], subtitles: ['Ш1'] },
    { id: 3, title: 'Документ 3', projects: ['П1'], subtitles: ['Ш2'] },
  ]
  const getValues = (documentRecord: (typeof documents)[number], key: string) => {
    if (key === 'title') return [documentRecord.title]
    if (key === 'project') return documentRecord.projects
    if (key === 'subtitle') return documentRecord.subtitles
    return ['']
  }

  it('limits the returned page while keeping the filtered total and dependent options', () => {
    const result = buildRemoteDocumentHistoryResult({
      documents,
      columnFilters: { project: buildWeldColumnValueFilter(['П1']) },
      limit: 1,
      getValues,
      filterKeys: ['title', 'project', 'subtitle'],
    })

    expect(result.documents.map((documentRecord) => documentRecord.id)).toEqual([1])
    expect(result.total).toBe(2)
    expect(result.filterOptions.project).toEqual([
      { value: 'П1', label: 'П1', count: 2 },
      { value: 'П2', label: 'П2', count: 1 },
    ])
    expect(result.filterOptions.subtitle).toEqual([
      { value: 'Ш1', label: 'Ш1', count: 1 },
      { value: 'Ш2', label: 'Ш2', count: 1 },
    ])
  })

  it('does not stop cumulative history loading at the former 5000-document boundary', () => {
    expect(normalizeDocumentHistoryLimit(5_100)).toBe(5_100)
  })

  it('normalizes a combined layered history without losing legacy single-type requests', () => {
    expect(normalizeGeneratedDocumentHistoryRequest({
      types: ['layeredVikEdges', 'layeredVikLayers', 'layeredVikEdges'],
    })).toEqual({
      type: 'layeredVikEdges',
      types: ['layeredVikEdges', 'layeredVikLayers'],
      limit: 100,
      columnFilters: {},
    })
    expect(normalizeGeneratedDocumentHistoryRequest({ type: 'checklist' }).types).toEqual(['checklist'])
  })

  it('keeps only a positive safe document id for exact history navigation', () => {
    expect(normalizeGeneratedDocumentHistoryRequest({
      type: 'checklist',
      documentId: 42,
    }).documentId).toBe(42)
    expect(normalizeGeneratedDocumentHistoryRequest({
      type: 'checklist',
      documentId: 42.5,
    })).not.toHaveProperty('documentId')
  })
})

describe('generated document reassignment database load', () => {
  it.each([2, 100, 1_200])('refreshes %i stale documents with a bounded query count', async (documentCount) => {
    const documentIds = Array.from({ length: documentCount }, (_, index) => index + 1)
    const populatedDocumentIds = documentIds.slice(0, -1)
    const summaries = populatedDocumentIds.map((documentId) => ({
      documentId,
      total: 1,
      periodFrom: '2026-09-01',
      periodTo: '2026-09-01',
    }))
    const wdiRows = populatedDocumentIds.map((documentId) => ({
      documentId,
      connectionType: null,
      d1: null,
      d2: null,
      t1: null,
      t2: null,
      wdi: 1,
    }))
    const select = vi.fn((selection: Record<string, unknown>) => {
      if ('total' in selection) {
        const chain = {
          from: vi.fn(),
          innerJoin: vi.fn(),
          where: vi.fn(),
          groupBy: vi.fn().mockResolvedValue(summaries),
        }
        chain.from.mockReturnValue(chain)
        chain.innerJoin.mockReturnValue(chain)
        chain.where.mockReturnValue(chain)
        return chain
      }
      const chain = {
        from: vi.fn(),
        innerJoin: vi.fn(),
        where: vi.fn().mockResolvedValue(wdiRows),
      }
      chain.from.mockReturnValue(chain)
      chain.innerJoin.mockReturnValue(chain)
      return chain
    })
    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    const deleteDocuments = vi.fn(() => ({ where: deleteWhere }))
    const execute = vi.fn().mockResolvedValue(undefined)
    const tx = {
      select,
      delete: deleteDocuments,
      execute,
    } as unknown as GeneratedDocumentsTransaction

    await refreshStaleGeneratedDocumentsInTransaction({
      tx,
      staleDocumentIds: documentIds,
      documentUpdatedAtById: new Map(
        documentIds.map((documentId) => [documentId, new Date('2026-09-04T10:00:00.000Z')]),
      ),
      otherSettings: DEFAULT_OTHER_SETTINGS,
      now: new Date('2026-09-04T10:01:00.000Z'),
    })

    const batchCount = Math.ceil(documentCount / 1_000)
    expect(select).toHaveBeenCalledTimes(batchCount * 2)
    expect(deleteDocuments).toHaveBeenCalledTimes(1)
    expect(deleteWhere).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(Math.ceil(populatedDocumentIds.length / 1_000))
  })
})

function input(title: string, weldJointIds: number[]): SaveGeneratedDocumentInput {
  return {
    type: 'weldingJournal',
    title,
    fileName: `${title}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    weldJointIds,
    expectedVersions: weldJointIds.map((id) => ({ id, version: String(100 + id) })),
  }
}

function batchRecord(inputIndex: number, targetDocumentId: number | null) {
  return {
    inputIndex,
    type: 'weldingJournal' as const,
    title: `ЖСР ${inputIndex + 1}`,
    fileName: `ЖСР ${inputIndex + 1}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    periodFrom: '2026-09-01',
    periodTo: '2026-09-01',
    rowCount: 1,
    wdiTotal: 1,
    documentNumber: inputIndex + 1,
    targetDocumentId,
    updatedAt: new Date('2026-09-04T10:00:00.000Z'),
  }
}
