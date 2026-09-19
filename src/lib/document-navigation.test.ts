import { describe, expect, it } from 'vitest'

import { getDocumentNavigationReferenceForField } from '@/lib/document-navigation'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('getDocumentNavigationReferenceForField', () => {
  it('builds an exact navigation reference for a generated journal document', () => {
    const row = {
      id: 1,
      jsrDocument: 'ЖСР-17',
      jsrDocumentId: 42,
    } as WeldRow

    expect(getDocumentNavigationReferenceForField(row, 'jsrDocument')).toEqual({
      kind: 'generated',
      documentId: 42,
      type: 'weldingJournal',
      title: 'ЖСР-17',
    })
  })

  it('keeps the persistent id for a system LNK document', () => {
    const row = {
      id: 1,
      vikRequest: '2009-1',
      vikRequestDate: '2026-09-18',
      systemDocumentIds: { vikRequest: 77 },
    } as WeldRow

    expect(getDocumentNavigationReferenceForField(row, 'vikRequest')).toEqual({
      kind: 'system',
      documentId: 77,
      type: 'lnkRequest',
      title: '2009-1',
      date: '2026-09-18',
    })
  })

  it('does not navigate to a generated document without its stored id', () => {
    const row = { id: 1, checklistDocument: 'Чек-лист-4' } as WeldRow

    expect(getDocumentNavigationReferenceForField(row, 'checklistDocument')).toBeNull()
  })
})
