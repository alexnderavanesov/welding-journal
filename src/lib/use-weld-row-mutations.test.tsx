import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWeldRowMutations } from '@/lib/use-weld-row-mutations'

const mocks = vi.hoisted(() => ({
  invalidateWeldJoints: vi.fn(),
  prepareWeldSaveValue: vi.fn(),
  moveWeldJointChainOrThrow: vi.fn(),
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
  moveWeldJointChainOrThrow: mocks.moveWeldJointChainOrThrow,
  updateWeldRowOrThrow: mocks.updateWeldRowOrThrow,
}))

vi.mock('@/server/weld-mutations-api', () => ({
  deleteWeldJoint: vi.fn(),
  deleteWeldJoints: vi.fn(),
}))

describe('useWeldRowMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes the editor without waiting for background report refreshes', async () => {
    const savedRow = { id: 17, line: 'LIN-1', joint: 'S1' }
    const setEditing = vi.fn()

    mocks.prepareWeldSaveValue.mockReturnValue(savedRow)
    mocks.updateWeldRowOrThrow.mockResolvedValue(savedRow)
    mocks.invalidateWeldJoints.mockReturnValue(undefined)

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
    await act(async () => {
      await savePromise
    })

    expect(setEditing).toHaveBeenCalledOnce()
    expect(setEditing).toHaveBeenCalledWith(null)
  })

  it('refreshes every returned row after an atomic chain move', async () => {
    const source = { id: 17, line: 'LIN-2', joint: 'S1' }
    const movedRows = [source, { id: 18, line: 'LIN-2', joint: 'S1Y1' }]
    const setMessage = vi.fn()
    mocks.prepareWeldSaveValue.mockReturnValue(source)
    mocks.moveWeldJointChainOrThrow.mockResolvedValue(movedRows)

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useWeldRowMutations({
      rows: [],
      welderStamps: [],
      welderStampSuspensions: [],
      weldFormStampSelectOptions: {},
      setEditing: vi.fn(),
      setMessage,
      highlightChangedRows: vi.fn(),
      dismissRepeatedJointTask: vi.fn(),
    }), { wrapper })

    await act(async () => {
      await result.current.saveMutation.mutateAsync({
        ...source,
        weldChainLineMovePlan: {
          expectedRowIds: [17, 18],
          decisions: [
            { rowId: 17, disposition: 'keepPrimary' },
            { rowId: 18, disposition: 'keepPrimary' },
          ],
        },
      })
    })

    expect(mocks.invalidateWeldJoints).toHaveBeenCalledWith(queryClient, { upsertRows: movedRows })
    expect(setMessage).toHaveBeenCalledWith('Цепочка стыка перенесена · записей: 2')
  })
})
