import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useManagedLnkResultActions } from '@/lib/use-managed-lnk-result-actions'
import type { WeldRow } from '@/lib/dispatcher-types'

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
    const setIsLnkResultModalOpen = vi.fn()
    const setManagedLnkResultOrderIds = vi.fn()
    const setManagedLnkConclusionDrafts = vi.fn()
    const setManagedLnkResultTargetKey = vi.fn()
    const setManagedLnkResultChangeHint = vi.fn()
    const setManagedLnkPendingResultChanges = vi.fn()

    const { result } = renderHook(() => useManagedLnkResultActions({
      isLnkRowsContextReady: true,
      lnkRows: [],
      selectedLnkResultRowIds: new Set(),
      managedLnkConclusionDrafts: {},
      managedLnkPendingResultChanges: { '7:vikRequest': 'годен' },
      managedLnkPendingResultRows: [{} as never],
      lnkResultCorrectionMutation: { mutate: vi.fn() },
      lnkResultReplacementMutation: { mutate },
      lnkConclusionCorrectionMutation: { mutate: vi.fn() },
      setMessage: vi.fn(),
      setIsLnkResultModalOpen,
      setIsLnkResultManagerOpen,
      setManagedLnkResultMethodKey: vi.fn(),
      setManagedLnkConclusionDrafts,
      setManagedLnkResultOrderIds,
      setManagedLnkResultTargetKey,
      setManagedLnkResultChangeHint,
      setManagedLnkPendingResultChanges,
    }))

    act(() => result.current.saveManagedLnkResultChanges())
    expect(setIsLnkResultManagerOpen).not.toHaveBeenCalled()

    act(() => finishSave?.())
    expect(setIsLnkResultManagerOpen).toHaveBeenCalledWith(false)
    expect(setManagedLnkConclusionDrafts).toHaveBeenCalledWith({})
    expect(setManagedLnkResultOrderIds).toHaveBeenCalledWith(null)
    expect(setManagedLnkResultTargetKey).toHaveBeenCalledWith('')
    expect(setManagedLnkResultChangeHint).toHaveBeenCalledWith(null)
    expect(setManagedLnkPendingResultChanges).toHaveBeenCalledWith({})
  })

  it('opens one exact result without leaving the add dialog underneath it', () => {
    const row = {
      id: 7,
      hasVik: 'да',
      vikRequest: 'Заявка-7',
      vikRequestDate: '2026-08-15',
      vikResult: 'годен',
    } as WeldRow
    const setIsLnkResultModalOpen = vi.fn()
    const setIsLnkResultManagerOpen = vi.fn()
    const setManagedLnkResultMethodKey = vi.fn()
    const setManagedLnkResultOrderIds = vi.fn()
    const setManagedLnkResultTargetKey = vi.fn()
    const setManagedLnkConclusionDrafts = vi.fn()

    const { result } = renderHook(() => useManagedLnkResultActions({
      isLnkRowsContextReady: true,
      lnkRows: [row],
      selectedLnkResultRowIds: new Set(),
      managedLnkConclusionDrafts: {},
      managedLnkPendingResultChanges: {},
      managedLnkPendingResultRows: [],
      lnkResultCorrectionMutation: { mutate: vi.fn() },
      lnkResultReplacementMutation: { mutate: vi.fn() },
      lnkConclusionCorrectionMutation: { mutate: vi.fn() },
      setMessage: vi.fn(),
      setIsLnkResultModalOpen,
      setIsLnkResultManagerOpen,
      setManagedLnkResultMethodKey,
      setManagedLnkConclusionDrafts,
      setManagedLnkResultOrderIds,
      setManagedLnkResultTargetKey,
      setManagedLnkResultChangeHint: vi.fn(),
      setManagedLnkPendingResultChanges: vi.fn(),
    }))

    act(() => result.current.openLnkResultManager({
      rowIds: [row.id],
      methodKey: 'vikRequest',
      targetKey: '7:vikRequest',
    }))

    expect(setManagedLnkResultMethodKey).toHaveBeenCalledWith('vikRequest')
    expect(setManagedLnkConclusionDrafts).toHaveBeenCalledWith({})
    expect(setManagedLnkResultOrderIds).toHaveBeenCalledWith([7])
    expect(setManagedLnkResultTargetKey).toHaveBeenCalledWith('7:vikRequest')
    expect(setIsLnkResultModalOpen).toHaveBeenCalledWith(false)
    expect(setIsLnkResultManagerOpen).toHaveBeenCalledWith(true)
  })

  it('opens the registry while its lazy full context is still loading', () => {
    const setMessage = vi.fn()
    const setIsLnkResultManagerOpen = vi.fn()

    const { result } = renderHook(() => useManagedLnkResultActions({
      isLnkRowsContextReady: false,
      lnkRows: [],
      selectedLnkResultRowIds: new Set(),
      managedLnkConclusionDrafts: {},
      managedLnkPendingResultChanges: {},
      managedLnkPendingResultRows: [],
      lnkResultCorrectionMutation: { mutate: vi.fn() },
      lnkResultReplacementMutation: { mutate: vi.fn() },
      lnkConclusionCorrectionMutation: { mutate: vi.fn() },
      setMessage,
      setIsLnkResultModalOpen: vi.fn(),
      setIsLnkResultManagerOpen,
      setManagedLnkResultMethodKey: vi.fn(),
      setManagedLnkConclusionDrafts: vi.fn(),
      setManagedLnkResultOrderIds: vi.fn(),
      setManagedLnkResultTargetKey: vi.fn(),
      setManagedLnkResultChangeHint: vi.fn(),
      setManagedLnkPendingResultChanges: vi.fn(),
    }))

    act(() => result.current.openLnkResultManager({ rowIds: null }))

    expect(setMessage).not.toHaveBeenCalled()
    expect(setIsLnkResultManagerOpen).toHaveBeenCalledWith(true)
  })
})
