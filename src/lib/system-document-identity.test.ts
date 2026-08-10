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
})
