import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWeldRowMutations } from '@/lib/use-weld-row-mutations'

const mocks = vi.hoisted(() => ({
  invalidateWeldJoints: vi.fn(),
  prepareWeldSaveValue: vi.fn(),
  updateWeldRowOrThrow: vi.fn(),
}))

vi.mock('@/lib/weld-query-utils', () => ({
  invalidateWeldJoints: mocks.invalidateWeldJoints,
}))

vi.mock('@/lib/weld-journal-mutation-updates', () => ({
  prepareWeldSaveValue: mocks.prepareWeldSaveValue,
}))

vi.mock('@/lib/weld-save-utils', () => ({
  createWeldRowOrThrow: vi.fn(),
  updateWeldRowOrThrow: mocks.updateWeldRowOrThrow,
}))

vi.mock('@/server/welds', () => ({
  deleteWeldJoint: vi.fn(),
}))

describe('useWeldRowMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes the editor only after the report data has finished refreshing', async () => {
    let finishInvalidation: (() => void) | undefined
    const invalidation = new Promise<void>((resolve) => {
      finishInvalidation = resolve
    })
    const savedRow = { id: 17, line: 'LIN-1', joint: 'S1' }
    const setEditing = vi.fn()

    mocks.prepareWeldSaveValue.mockReturnValue(savedRow)
    mocks.updateWeldRowOrThrow.mockResolvedValue(savedRow)
    mocks.invalidateWeldJoints.mockReturnValue(invalidation)

    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () =>
        useWeldRowMutations({
          rows: [],
          welderStamps: [],
          welderStampSuspensions: [],
          weldFormStampSelectOptions: {},
          editingFocusField: undefined,
          setEditing,
          setMessage: vi.fn(),
          highlightChangedRows: vi.fn(),
          dismissRepeatedJointTask: vi.fn(),
        }),
      { wrapper },
    )

    let savePromise: Promise<unknown>
    act(() => {
      savePromise = result.current.saveMutation.mutateAsync(savedRow)
    })

    await waitFor(() => expect(mocks.invalidateWeldJoints).toHaveBeenCalledOnce())
    expect(setEditing).not.toHaveBeenCalled()

    finishInvalidation?.()
    await act(async () => {
      await savePromise
    })

    expect(setEditing).toHaveBeenCalledOnce()
    expect(setEditing).toHaveBeenCalledWith(null)
  })
})
