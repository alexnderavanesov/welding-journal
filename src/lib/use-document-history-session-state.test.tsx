import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  parseStoredDocumentNumberId,
  parseStoredDocumentStringId,
  useDocumentHistorySessionState,
  useDocumentHistorySessionValue,
} from '@/lib/use-document-history-session-state'

describe('useDocumentHistorySessionState', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('restores selected generated documents and the loaded range after remount', () => {
    const first = renderHook(() =>
      useDocumentHistorySessionState('generated:weldingJournal', parseStoredDocumentNumberId),
    )

    act(() => {
      first.result.current.setSelectedDocumentIds(new Set([17, 23]))
      first.result.current.setPageSize(300)
      first.result.current.setVisibleLimit(600)
    })
    first.unmount()

    const restored = renderHook(() =>
      useDocumentHistorySessionState('generated:weldingJournal', parseStoredDocumentNumberId),
    )
    expect([...restored.result.current.selectedDocumentIds]).toEqual([17, 23])
    expect(restored.result.current.pageSize).toBe(300)
    expect(restored.result.current.visibleLimit).toBe(600)
  })

  it('keeps separate state for each document register', () => {
    const { result, rerender } = renderHook(
      ({ storageKey }) => useDocumentHistorySessionState(storageKey, parseStoredDocumentStringId),
      { initialProps: { storageKey: 'system:lnkRequest:lnk' } },
    )
    act(() => result.current.setSelectedDocumentIds(new Set(['request-1'])))

    rerender({ storageKey: 'system:lnkConclusion:lnk' })
    expect([...result.current.selectedDocumentIds]).toEqual([])
    act(() => result.current.setSelectedDocumentIds(new Set(['conclusion-1'])))

    rerender({ storageKey: 'system:lnkRequest:lnk' })
    expect([...result.current.selectedDocumentIds]).toEqual(['request-1'])
  })

  it('ignores malformed ids and pagination restored from the browser', () => {
    window.sessionStorage.setItem(
      'welding-journal:documents:session:v1:generated:zni',
      JSON.stringify({
        selectedDocumentIds: [4, '5', -1, 2.5, null],
        pageSize: 777,
        visibleLimit: -10,
      }),
    )

    const { result } = renderHook(() =>
      useDocumentHistorySessionState('generated:zni', parseStoredDocumentNumberId),
    )
    expect([...result.current.selectedDocumentIds]).toEqual([4])
    expect(result.current.pageSize).toBe(100)
    expect(result.current.visibleLimit).toBe(100)
  })
})

describe('useDocumentHistorySessionValue', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('restores a valid register view value and rejects an obsolete one', () => {
    const isView = (value: unknown): value is 'all' | 'vik' => value === 'all' || value === 'vik'
    const first = renderHook(() =>
      useDocumentHistorySessionValue('system:lnkConclusion:lnk:view', 'all', isView),
    )
    act(() => first.result.current[1]('vik'))
    first.unmount()

    const restored = renderHook(() =>
      useDocumentHistorySessionValue('system:lnkConclusion:lnk:view', 'all', isView),
    )
    expect(restored.result.current[0]).toBe('vik')

    window.sessionStorage.setItem(
      'welding-journal:documents:session:v1:system:lnkConclusion:lnk:obsolete-view',
      JSON.stringify('removed'),
    )
    const obsolete = renderHook(() =>
      useDocumentHistorySessionValue('system:lnkConclusion:lnk:obsolete-view', 'all', isView),
    )
    expect(obsolete.result.current[0]).toBe('all')
  })
})
