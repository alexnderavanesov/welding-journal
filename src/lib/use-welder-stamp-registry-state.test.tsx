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

  it('keeps suspension dates until the server confirms and allows retry after rejection', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>
      <ConfirmActionProvider>{children}</ConfirmActionProvider></QueryClientProvider>
    const { result } = renderHook(() => useWelderStampRegistryState({ setMessage: vi.fn() }), { wrapper })
    await waitFor(() => expect(serverMocks.loadWelderStampRegistrySnapshot).toHaveBeenCalledOnce())
    const draft = { id: 0, naksStamp: 'AUD2', suspendedFrom: '2026-10-01', suspendedTo: '2026-10-15' }
    act(() => result.current.editWelderStampSuspensionRecord(draft))
    let rejectSave!: (reason: Error) => void
    serverMocks.saveWelderStampSuspensionRecords.mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject }))
    let first: boolean | Promise<boolean>
    act(() => { first = result.current.saveWelderStampSuspensionRecord() })
    await waitFor(() => expect(serverMocks.saveWelderStampSuspensionRecords).toHaveBeenCalledOnce())
    expect(result.current.welderStampSuspensionDraft).toEqual(draft)
    await act(async () => { expect(await result.current.saveWelderStampSuspensionRecord()).toBe(false) })
    expect(serverMocks.saveWelderStampSuspensionRecords).toHaveBeenCalledOnce()
    await act(async () => { rejectSave(new Error('Конфликт версии')); expect(await first!).toBe(false) })
    expect(result.current.welderStampSuspensionDraft).toEqual(draft)
    expect(result.current.welderStampSuspensions).toEqual([])
    serverMocks.saveWelderStampSuspensionRecords.mockResolvedValue({ stamps: [], suspensions: [{ ...draft, id: 1 }], revision: 'saved' })
    await act(async () => { expect(await result.current.saveWelderStampSuspensionRecord()).toBe(true) })
    expect(result.current.welderStampSuspensionDraft.naksStamp).toBe('')
    expect(result.current.welderStampSuspensions).toEqual([{ ...draft, id: 1 }])
  })

  it.each([[true, false], [false, false], [true, true], [false, true]])('reconciles a lost suspension response only when fresh dates match (%s), retrying the read (%s)', async (matches, retryRead) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>
      <ConfirmActionProvider>{children}</ConfirmActionProvider></QueryClientProvider>
    const message = vi.fn()
    const { result } = renderHook(() => useWelderStampRegistryState({ setMessage: message }), { wrapper })
    await waitFor(() => expect(serverMocks.loadWelderStampRegistrySnapshot).toHaveBeenCalledOnce())
    const draft = { id: 0, naksStamp: 'AUD2', suspendedFrom: '2026-10-01', suspendedTo: '2026-10-15' }
    act(() => result.current.editWelderStampSuspensionRecord(draft))
    const saved = { ...draft, id: 1, suspendedTo: matches ? draft.suspendedTo : '2026-10-20' }
    serverMocks.loadWelderStampRegistrySnapshot.mockResolvedValue({ stamps: [], suspensions: [saved], revision: 'confirmed' })
    if (retryRead) serverMocks.loadWelderStampRegistrySnapshot.mockRejectedValueOnce(new TypeError('Чтение прервано'))
    serverMocks.saveWelderStampSuspensionRecords.mockRejectedValue(new TypeError('Ответ потерян'))
    await act(async () => { expect(await result.current.saveWelderStampSuspensionRecord()).toBe(matches) })
    expect(serverMocks.saveWelderStampSuspensionRecords).toHaveBeenCalledOnce()
    expect(result.current.welderStampSuspensions).toEqual([saved])
    expect(result.current.welderStampSuspensionDraft).toEqual(matches ? { id: 0, naksStamp: '', suspendedFrom: '', suspendedTo: '' } : draft)
    if (matches) expect(message).toHaveBeenLastCalledWith(expect.stringContaining('подтверждено повторной проверкой'))
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
