import { describe, expect, it } from 'vitest'
import {
  GENERATED_DOCUMENT_HISTORY_COLUMNS,
  LAYERED_GENERATED_DOCUMENT_HISTORY_COLUMNS,
  SYSTEM_DOCUMENT_HISTORY_COLUMNS,
  getVisibleDocumentHistoryColumns,
  parseDocumentHistoryColumnPreferences,
} from '@/lib/document-history-columns'

describe('document history column preferences', () => {
  it('ignores malformed and unknown stored values', () => {
    expect(parseDocumentHistoryColumnPreferences('{broken')).toEqual({})
    expect(parseDocumentHistoryColumnPreferences(JSON.stringify({
      lnkConclusion: ['stage', 'unknown', 'stage', 42],
      invalid: 'stage',
    }))).toEqual({ lnkConclusion: ['stage'] })
  })

  it('keeps the document column visible and restores the configured order', () => {
    const preferences = parseDocumentHistoryColumnPreferences(JSON.stringify({ lnkConclusion: ['stage', 'date'] }))

    expect(getVisibleDocumentHistoryColumns({
      viewId: 'lnkConclusion',
      availableColumns: SYSTEM_DOCUMENT_HISTORY_COLUMNS,
      preferences,
    }).map((column) => column.key)).toEqual(['title', 'stage', 'date'])
  })

  it.each([
    ['generated', GENERATED_DOCUMENT_HISTORY_COLUMNS],
    ['layered', LAYERED_GENERATED_DOCUMENT_HISTORY_COLUMNS],
    ['system', SYSTEM_DOCUMENT_HISTORY_COLUMNS],
  ])('offers the joint count in %s and respects personal hiding', (viewId, availableColumns) => {
    expect(getVisibleDocumentHistoryColumns({ viewId, availableColumns, preferences: {} }))
      .toContainEqual({ key: 'rowCount', label: 'Стыков', minWidth: 110, align: 'end' })
    expect(getVisibleDocumentHistoryColumns({ viewId, availableColumns, preferences: { [viewId]: ['title'] } })
      .map(column => column.key)).toEqual(['title'])
  })

})
