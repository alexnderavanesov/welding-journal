import { describe, expect, it } from 'vitest'
import { getDocumentHistoryFilterMenuPosition } from '@/lib/document-history-filter-menu'

describe('getDocumentHistoryFilterMenuPosition', () => {
  it('opens below the filter when the viewport has enough space', () => {
    expect(getDocumentHistoryFilterMenuPosition({
      anchorLeft: 56,
      anchorRight: 216,
      anchorTop: 52,
      anchorBottom: 84,
      viewportWidth: 1200,
      viewportHeight: 800,
    })).toEqual({
      left: 56,
      width: 288,
      maxHeight: 420,
      placement: 'below',
      offset: 90,
    })
  })

  it('opens above the filter and limits its height near the bottom edge', () => {
    expect(getDocumentHistoryFilterMenuPosition({
      anchorLeft: 320,
      anchorRight: 480,
      anchorTop: 500,
      anchorBottom: 532,
      viewportWidth: 1200,
      viewportHeight: 600,
    })).toEqual({
      left: 320,
      width: 288,
      maxHeight: 420,
      placement: 'above',
      offset: 106,
    })
  })

  it('keeps a right-aligned filter inside a narrow viewport', () => {
    expect(getDocumentHistoryFilterMenuPosition({
      anchorLeft: 276,
      anchorRight: 356,
      anchorTop: 40,
      anchorBottom: 72,
      viewportWidth: 360,
      viewportHeight: 400,
      alignRight: true,
    })).toEqual({
      left: 60,
      width: 288,
      maxHeight: 310,
      placement: 'below',
      offset: 78,
    })
  })
})
