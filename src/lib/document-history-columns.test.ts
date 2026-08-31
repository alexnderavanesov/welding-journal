import { describe, expect, it } from 'vitest'
import {
  GENERATED_DOCUMENT_HISTORY_COLUMNS,
  SYSTEM_DOCUMENT_HISTORY_COLUMNS,
  getDocumentHistoryGridLayout,
  getVisibleDocumentHistoryColumns,
  parseDocumentHistoryColumnPreferences,
  retainVisibleDocumentHistoryColumnFilters,
  setVisibleDocumentHistoryColumns,
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
    const preferences = setVisibleDocumentHistoryColumns({
      viewId: 'lnkConclusion',
      visibleColumnKeys: ['stage', 'date'],
      availableColumns: SYSTEM_DOCUMENT_HISTORY_COLUMNS,
      preferences: {},
    })

    expect(preferences.lnkConclusion).toEqual(['title', 'stage', 'date'])
    expect(getVisibleDocumentHistoryColumns({
      viewId: 'lnkConclusion',
      availableColumns: SYSTEM_DOCUMENT_HISTORY_COLUMNS,
      preferences,
    }).map((column) => column.key)).toEqual(['title', 'stage', 'date'])
  })

  it('builds a compact grid from only the visible columns', () => {
    const visibleColumns = GENERATED_DOCUMENT_HISTORY_COLUMNS.filter((column) =>
      ['title', 'rowCount'].includes(column.key),
    )

    expect(getDocumentHistoryGridLayout({ columns: visibleColumns, actionsWidth: 168 })).toEqual({
      gridTemplateColumns: '34px minmax(280px, 1.5fr) 84px 168px',
      minWidth: 646,
    })
  })

  it('removes a filter when its column is hidden', () => {
    expect(retainVisibleDocumentHistoryColumnFilters(
      { title: 'ЗНК', stage: 'До ТО', date: '2026-08-30' },
      new Set(['title', 'date']),
    )).toEqual({ title: 'ЗНК', date: '2026-08-30' })
  })
})
