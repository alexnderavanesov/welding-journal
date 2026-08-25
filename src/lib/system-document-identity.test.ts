import { describe, expect, it } from 'vitest'

import { matchSystemDocumentIdentityIds } from '@/lib/system-document-identity'

describe('system document identity matching', () => {
  it('keeps the permanent ID with the unchanged part after a document is split', () => {
    const matches = matchSystemDocumentIdentityIds({
      documents: [
        { id: 10, type: 'system:lnkRequest', title: 'Заявка №1', periodFrom: '2026-08-10' },
      ],
      targets: [
        { type: 'system:lnkRequest', title: 'Пользовательское имя', date: '2026-08-10', rowIds: [1] },
        { type: 'system:lnkRequest', title: 'Заявка №1', date: '2026-08-10', rowIds: [2] },
      ],
      assignedRowsByDocument: new Map([[10, new Set([1, 2])]]),
    })

    expect(matches.get(0)).toBeUndefined()
    expect(matches.get(1)).toBe(10)
  })

  it('keeps the permanent ID when the whole document is renamed', () => {
    const matches = matchSystemDocumentIdentityIds({
      documents: [
        { id: 10, type: 'system:lnkRequest', title: 'Заявка №1', periodFrom: '2026-08-10' },
      ],
      targets: [
        { type: 'system:lnkRequest', title: 'Заявка №1 исправленная', date: '2026-08-10', rowIds: [1, 2] },
      ],
      assignedRowsByDocument: new Map([[10, new Set([1, 2])]]),
    })

    expect(matches.get(0)).toBe(10)
  })

  it('never assigns one stored ID to two resulting documents', () => {
    const matches = matchSystemDocumentIdentityIds({
      documents: [
        { id: 10, type: 'system:lnkRequest', title: 'Заявка №1', periodFrom: '2026-08-10' },
      ],
      targets: [
        { type: 'system:lnkRequest', title: 'Новое имя A', date: '2026-08-10', rowIds: [1] },
        { type: 'system:lnkRequest', title: 'Новое имя B', date: '2026-08-10', rowIds: [2] },
      ],
      assignedRowsByDocument: new Map([[10, new Set([1, 2])]]),
    })

    expect([...matches.values()]).toEqual([10])
  })

  it('keeps fallback LNK methods separate when their template, title, and date match', () => {
    const matches = matchSystemDocumentIdentityIds({
      documents: [
        { id: 10, type: 'system:lnkConclusionOther', title: 'Заключение лаборатории', periodFrom: '2026-08-25' },
        { id: 11, type: 'system:lnkConclusionOther', title: 'Заключение лаборатории', periodFrom: '2026-08-25' },
      ],
      targets: [
        { type: 'system:lnkConclusionOther', title: 'Заключение лаборатории', date: '2026-08-25', rowIds: [1, 2] },
        { type: 'system:lnkConclusionOther', title: 'Заключение лаборатории', date: '2026-08-25', rowIds: [3] },
      ],
      assignedRowsByDocument: new Map([
        [10, new Set([1, 2])],
        [11, new Set([3])],
      ]),
    })

    expect(matches).toEqual(new Map([[0, 10], [1, 11]]))
  })

  it('keeps fallback LNK method IDs stable when both documents contain the same rows', () => {
    const matches = matchSystemDocumentIdentityIds({
      documents: [
        { id: 10, type: 'system:lnkConclusionOther', title: 'Общее имя', periodFrom: '2026-08-25', identityScope: 'ТВМТ' },
        { id: 11, type: 'system:lnkConclusionOther', title: 'Общее имя', periodFrom: '2026-08-25', identityScope: 'РФА' },
      ],
      targets: [
        { type: 'system:lnkConclusionOther', title: 'Общее имя', date: '2026-08-25', rowIds: [1], identityScope: 'РФА' },
        { type: 'system:lnkConclusionOther', title: 'Общее имя', date: '2026-08-25', rowIds: [1], identityScope: 'ТВМТ' },
      ],
      assignedRowsByDocument: new Map([
        [10, new Set([1])],
        [11, new Set([1])],
      ]),
    })

    expect(matches).toEqual(new Map([[0, 11], [1, 10]]))
  })
})
