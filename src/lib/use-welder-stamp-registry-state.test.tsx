import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmActionProvider } from '@/lib/confirm-action-context'
import { useWelderStampRegistryState } from '@/lib/use-welder-stamp-registry-state'
import { createEmptyWelderStampDraft } from '@/lib/welder-stamp-registry'
import { createEmptyNaksPermit } from '@/lib/welder-stamp-permits'

const serverMocks = vi.hoisted(() => ({
  loadWelderStampRegistrySnapshot: vi.fn(),
  saveWelderStampRecords: vi.fn(),
  saveWelderStampSuspensionRecords: vi.fn(),
}))

vi.mock('@/server/welder-stamps', () => serverMocks)

describe('useWelderStampRegistryState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serverMocks.loadWelderStampRegistrySnapshot.mockResolvedValue({
      stamps: [],
      suspensions: [],
      revision: 'empty',
    })
  })

  it('does not load the registry until the active section needs it', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ConfirmActionProvider>{children}</ConfirmActionProvider>
      </QueryClientProvider>
    )
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useWelderStampRegistryState({ enabled, setMessage: vi.fn() }),
      { initialProps: { enabled: false }, wrapper },
    )

    expect(serverMocks.loadWelderStampRegistrySnapshot).not.toHaveBeenCalled()

    rerender({ enabled: true })

    await waitFor(() => expect(serverMocks.loadWelderStampRegistrySnapshot).toHaveBeenCalledTimes(1))
  })

  it('keeps the draft after a failed save and coalesces repeated clicks until confirmation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>
      <ConfirmActionProvider>{children}</ConfirmActionProvider></QueryClientProvider>
    const { result } = renderHook(() => useWelderStampRegistryState({ setMessage: vi.fn() }), { wrapper })
    await waitFor(() => expect(serverMocks.loadWelderStampRegistrySnapshot).toHaveBeenCalledOnce())
    const record = { ...createEmptyWelderStampDraft(), id: 42, naksStamp: 'AUD2', naksPermits: [{
      ...createEmptyNaksPermit(), id: 'preserve', weldType: 'РАД', materialGroups: 'М01, М05',
      diameterFrom: '1', diameterTo: '500', thicknessFrom: '1', thicknessTo: '20',
      validFrom: '2026-01-01', validTo: '2026-12-31', note: 'Черновик',
    }] }
    act(() => result.current.editWelderStampRecord(record))
    let rejectSave!: (reason: Error) => void
    serverMocks.saveWelderStampRecords.mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject }))
    let first: boolean | Promise<boolean>
    act(() => { first = result.current.saveWelderStampRecord() })
    await waitFor(() => expect(serverMocks.saveWelderStampRecords).toHaveBeenCalledOnce())
    expect(result.current.welderStampDraft.naksPermits[0].note).toBe('Черновик')
    await act(async () => { expect(await result.current.saveWelderStampRecord()).toBe(false) })
    expect(serverMocks.saveWelderStampRecords).toHaveBeenCalledOnce()
    await act(async () => { rejectSave(new Error('Нет сети')); expect(await first!).toBe(false) })
    expect(result.current.welderStampDraft.naksPermits[0].materialGroups).toBe('М01, М05')
    expect(result.current.editingWelderStampId).toBe(42)
  })
})
