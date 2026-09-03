import { describe, expect, it } from 'vitest'

import {
  buildRemoteDocumentHistoryResult,
  normalizeGeneratedDocumentHistoryRequest,
  normalizeDocumentHistoryLimit,
  normalizeSaveGeneratedDocumentBatch,
  type SaveGeneratedDocumentInput,
} from '@/server/generated-documents'
import { buildWeldColumnValueFilter } from '@/lib/weld-table-filtering'

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
})

function input(title: string, weldJointIds: number[]): SaveGeneratedDocumentInput {
  return {
    type: 'weldingJournal',
    title,
    fileName: `${title}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    weldJointIds,
  }
}
