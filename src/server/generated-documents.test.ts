import { describe, expect, it } from 'vitest'

import {
  normalizeSaveGeneratedDocumentBatch,
  type SaveGeneratedDocumentInput,
} from '@/server/generated-documents'

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
