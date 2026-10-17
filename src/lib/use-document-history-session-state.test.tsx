import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useDocumentHistorySessionValue } from '@/lib/use-document-history-session-state'

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
