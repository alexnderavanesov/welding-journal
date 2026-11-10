import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useLineSchemeSession } from './use-line-scheme-session'
import { openLineScheme, keepLineSchemeLease } from '@/server/line-schemes-api'

vi.mock('@/server/line-schemes-api', () => ({ openLineScheme: vi.fn(), keepLineSchemeLease: vi.fn() }))
const snapshot = () => ({ bundle: { id: 7, lineId: 3, projectTitle: 'P', subtitleCode: 'C', line: 'L', activeRevisionId: null, version: 1, deleted: false, revisions: [] }, lease: { owned: true, name: 'Operator', expiresAt: new Date(Date.now() + 180000).toISOString() } })
beforeEach(() => { vi.mocked(openLineScheme).mockReset().mockResolvedValue(snapshot()); vi.mocked(keepLineSchemeLease).mockReset().mockResolvedValue({ owned: false, name: null, expiresAt: null }) })
afterEach(async () => { cleanup(); await act(async () => {}); vi.restoreAllMocks() })

it('does not poll for editing access while another window owns the lease', async () => {
  vi.mocked(openLineScheme).mockResolvedValue({ ...snapshot(), lease: { ...snapshot().lease, owned: false, name: 'Another editor' } })
  const { result } = renderHook(() => useLineSchemeSession(3))
  await waitFor(() => expect(result.current.opening).toBe(false))
  vi.useFakeTimers()
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(65_000) })
    expect(openLineScheme).toHaveBeenCalledOnce()
    expect(keepLineSchemeLease).not.toHaveBeenCalled()
    expect(result.current.lease.owned).toBe(false)
  } finally { vi.useRealTimers() }
})

it('releases a delayed opening before acquiring again during StrictMode replay', async () => {
  const calls: string[] = []; let resolveFirst!: (value: ReturnType<typeof snapshot>) => void
  vi.mocked(openLineScheme).mockImplementationOnce(() => { calls.push('first open'); return new Promise(resolve => { resolveFirst = resolve }) })
    .mockImplementation(async () => { calls.push('new open'); return snapshot() })
  vi.mocked(keepLineSchemeLease).mockImplementation(async () => { calls.push('release'); return { owned: false, name: null, expiresAt: null } })
  const { result } = renderHook(() => useLineSchemeSession(3), { reactStrictMode: true })
  await waitFor(() => expect(calls).toEqual(['first open']))
  await act(async () => resolveFirst(snapshot()))
  await waitFor(() => expect(result.current.opening).toBe(false))
  expect(calls).toEqual(['first open', 'release', 'new open'])
  expect(result.current.lease.owned).toBe(true)
})

it('releases an opening that finishes after the window was closed', async () => {
  let resolve!: (value: ReturnType<typeof snapshot>) => void
  vi.mocked(openLineScheme).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const view = renderHook(() => useLineSchemeSession(3))
  await waitFor(() => expect(openLineScheme).toHaveBeenCalledOnce())
  view.unmount(); await act(async () => resolve(snapshot()))
  await waitFor(() => expect(keepLineSchemeLease).toHaveBeenCalledOnce())
  expect(vi.mocked(keepLineSchemeLease).mock.calls[0][0]?.data).toMatchObject({ bundleId: 7, release: true })
})

it('uses a keepalive release on pagehide, and never silently reacquires on bfcache restore', async () => {
  const { result } = renderHook(() => useLineSchemeSession(3))
  await waitFor(() => expect(result.current.opening).toBe(false))
  await act(async () => window.dispatchEvent(new Event('pagehide')))
  await waitFor(() => expect(keepLineSchemeLease).toHaveBeenCalledOnce())
  const release = vi.mocked(keepLineSchemeLease).mock.calls[0][0]!
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  await release.fetch!('/release', { method: 'POST' })
  expect(fetch).toHaveBeenCalledWith('/release', expect.objectContaining({ keepalive: true }))
  vi.mocked(openLineScheme).mockResolvedValue({ ...snapshot(), bundle: { ...snapshot().bundle, version: 2 }, lease: { owned: false, name: null, expiresAt: null } })
  const restore = new Event('pageshow'); Object.defineProperty(restore, 'persisted', { value: true })
  await act(async () => window.dispatchEvent(restore))
  await waitFor(() => expect(result.current.lease.owned).toBe(false))
  expect(vi.mocked(openLineScheme).mock.calls.at(-1)?.[0]?.data.acquire).toBe(false)
  expect(result.current.bundle?.version).toBe(1)
})
