import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmActionProvider } from '@/lib/confirm-action-context'
import { useManagedLnkRequestActions } from '@/lib/use-managed-lnk-request-actions'

describe('useManagedLnkRequestActions', () => {
  it('keeps an explicitly requested identity instead of falling back to the first request', () => {
    const setManagedLnkRequestName = vi.fn()
    const setManagedLnkRequestDate = vi.fn()
    const setManagedLnkRequestNameDraft = vi.fn()
    const setIsLnkRequestManagerOpen = vi.fn()
    const mutation = { isPending: false, mutate: vi.fn() }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConfirmActionProvider>{children}</ConfirmActionProvider>
    )
    const { result } = renderHook(() => useManagedLnkRequestActions({
      lnkRequestManagerOptions: [{
        key: '["Первая","2026-08-01"]',
        name: 'Первая',
        date: '2026-08-01',
        label: 'Первая · 01.08.2026',
      }],
      managedLnkRequestName: '',
      managedLnkRequestDate: '',
      managedLnkRequestNameDraft: '',
      lnkRequestCorrectionMutation: mutation,
      lnkRequestManagerMutation: mutation,
      setIsLnkRequestManagerOpen,
      setManagedLnkRequestName,
      setManagedLnkRequestDate,
      setManagedLnkRequestNameDraft,
    }), { wrapper })

    act(() => result.current.openLnkRequestManager('Точная', '2026-08-14'))

    expect(setManagedLnkRequestName).toHaveBeenCalledWith('Точная')
    expect(setManagedLnkRequestDate).toHaveBeenCalledWith('2026-08-14')
    expect(setManagedLnkRequestNameDraft).toHaveBeenCalledWith('Точная')
    expect(setIsLnkRequestManagerOpen).toHaveBeenCalledWith(true)
  })
})
