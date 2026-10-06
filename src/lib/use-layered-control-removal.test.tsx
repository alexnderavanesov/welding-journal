import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { useLayeredControlRemoval } from '@/lib/use-layered-control-removal'

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), password: vi.fn(), change: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/lib/confirm-action-context', () => ({ useConfirmAction: () => mocks.confirm }))
vi.mock('@/lib/security-context', () => ({ useSecurityGuard: () => ({ requireEditPassword: mocks.password }) }))
vi.mock('@/server/line-program-control', () => ({ changeLayeredControl: mocks.change }))
vi.mock('@/lib/weld-query-utils', () => ({ scheduleWeldDataRefresh: mocks.invalidate }))

const row = { id: 41, joint: 'F41', line: 'L-9', layeredControlAssigned: true, rowVersion: 'version-41', pvkResult: 'годен', pvkConclusion: 'ПВК-41' } as WeldRow
const saved = { ...row, layeredControlAssigned: false, rowVersion: 'next-41' }

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
  return { client, ...renderHook(() => useLayeredControlRemoval(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.confirm.mockResolvedValue(true)
  mocks.password.mockResolvedValue(true)
  mocks.change.mockResolvedValue([saved])
})

describe('useLayeredControlRemoval', () => {
  it('does no work on mount and sends only the confirmed row and its version once', async () => {
    const { result, client } = setup()
    expect(mocks.change).not.toHaveBeenCalled()
    expect(mocks.invalidate).not.toHaveBeenCalled()
    act(() => { result.current.remove(row); result.current.remove(row) })
    await waitFor(() => expect(result.current.feedback?.tone).toBe('success'))
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ itemName: 'L-9 · F41', description: expect.stringContaining('Обычный результат ПВК') }))
    expect(mocks.password).toHaveBeenCalledOnce()
    expect(mocks.change).toHaveBeenCalledExactlyOnceWith({ data: { targets: [{ id: 41, version: 'version-41' }], assigned: false, confirmedRemoval: true } })
    expect(mocks.invalidate).toHaveBeenCalledExactlyOnceWith(client, { upsertRows: [saved] })
    expect(result.current.feedback?.rowId).toBe(41)
  })

  it.each(['confirmation', 'password'])('does not mutate or invalidate when %s is declined', async (stage) => {
    if (stage === 'confirmation') mocks.confirm.mockResolvedValue(false)
    else mocks.password.mockResolvedValue(false)
    const { result } = setup()
    await act(async () => { result.current.remove(row) })
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(mocks.change).not.toHaveBeenCalled()
    expect(mocks.invalidate).not.toHaveBeenCalled()
    expect(result.current.feedback).toBeNull()
    if (stage === 'confirmation') expect(mocks.password).not.toHaveBeenCalled()
  })

  it('ignores an unassigned row', () => {
    const { result } = setup()
    act(() => result.current.remove({ ...row, layeredControlAssigned: false }))
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.change).not.toHaveBeenCalled()
  })

  it('keeps a stale-version failure local to its row, does not patch caches and permits retry', async () => {
    mocks.change.mockRejectedValueOnce(new Error('Стык уже изменен другим пользователем. Обновите данные.'))
    const { result, rerender } = setup()
    act(() => result.current.remove(row))
    await waitFor(() => expect(result.current.feedback).toEqual({ rowId: 41, tone: 'error', message: 'Стык уже изменен другим пользователем. Обновите данные.' }))
    expect(mocks.invalidate).not.toHaveBeenCalled()
    rerender()
    expect(mocks.change).toHaveBeenCalledOnce()
    act(() => result.current.remove({ ...row, rowVersion: 'fresh-41' }))
    await waitFor(() => expect(result.current.feedback?.tone).toBe('success'))
    expect(mocks.change).toHaveBeenCalledTimes(2)
    expect(mocks.change.mock.lastCall?.[0].data.targets).toEqual([{ id: 41, version: 'fresh-41' }])
  })
})
