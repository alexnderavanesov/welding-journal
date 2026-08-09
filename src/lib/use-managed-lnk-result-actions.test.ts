import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useManagedLnkResultActions } from '@/lib/use-managed-lnk-result-actions'

const mocks = vi.hoisted(() => ({
  buildUpdates: vi.fn(() => [{ record: { id: 7 }, methodKey: 'vikRequest', result: 'годен' }]),
}))

vi.mock('@/lib/confirm-action-context', () => ({
  useConfirmAction: () => vi.fn(),
}))

vi.mock('@/lib/managed-lnk-result-utils', () => ({
  buildManagedLnkResultReplacementUpdates: mocks.buildUpdates,
  getManagedLnkResultChangeHint: vi.fn(),
}))

describe('useManagedLnkResultActions', () => {
  it('closes the result manager only after a successful save', () => {
    let finishSave: (() => void) | undefined
    const mutate = vi.fn((_variables, options?: { onSuccess?: () => void }) => {
      finishSave = options?.onSuccess
    })
    const setIsLnkResultManagerOpen = vi.fn()
    const setManagedLnkResultOrderIds = vi.fn()
    const setManagedLnkResultChangeHint = vi.fn()
    const setManagedLnkPendingResultChanges = vi.fn()

    const { result } = renderHook(() => useManagedLnkResultActions({
      lnkRows: [],
      selectedLnkResultRowIds: new Set(),
      managedLnkConclusionDrafts: {},
      managedLnkPendingResultChanges: { '7:vikRequest': 'годен' },
      managedLnkPendingResultRows: [{} as never],
      lnkResultCorrectionMutation: { mutate: vi.fn() },
      lnkResultReplacementMutation: { mutate },
      lnkConclusionCorrectionMutation: { mutate: vi.fn() },
      setMessage: vi.fn(),
      setIsLnkResultManagerOpen,
      setManagedLnkResultMethodKey: vi.fn(),
      setManagedLnkConclusionDrafts: vi.fn(),
      setManagedLnkResultOrderIds,
      setManagedLnkResultChangeHint,
      setManagedLnkPendingResultChanges,
    }))

    act(() => result.current.saveManagedLnkResultChanges())
    expect(setIsLnkResultManagerOpen).not.toHaveBeenCalled()

    act(() => finishSave?.())
    expect(setIsLnkResultManagerOpen).toHaveBeenCalledWith(false)
    expect(setManagedLnkResultOrderIds).toHaveBeenCalledWith(null)
    expect(setManagedLnkResultChangeHint).toHaveBeenCalledWith(null)
    expect(setManagedLnkPendingResultChanges).toHaveBeenCalledWith({})
  })
})
