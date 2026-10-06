import type { PropsWithChildren } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { useStatisticsServerQuery } from './use-statistics-server-query'
import { scheduleWeldDataRefresh } from './weld-query-utils'
import type { StatisticsServerRequest } from './statistics-server-summary'

const rpc = vi.hoisted(() => vi.fn(async ({ data }: { data: StatisticsServerRequest }) => ({ tab: data.tab })))
vi.mock('@/server/statistics', () => ({ getStatisticsServerResult: rpc }))

it('coalesces mounts, keeps stable keys, and refreshes only the active statistics slice after a mutation', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const initial: StatisticsServerRequest = { tab: 'general', unit: 'joints' }
  rpc.mockClear()
  const hook = renderHook(({ request }) => ({ first: useStatisticsServerQuery(request), second: useStatisticsServerQuery({ ...request }) }),
    { wrapper, initialProps: { request: initial } })
  try {
    await waitFor(() => expect(hook.result.current.first.isFetching).toBe(false))
    expect(rpc).toHaveBeenCalledTimes(1)
    hook.rerender({ request: { ...initial } })
    expect(rpc).toHaveBeenCalledTimes(1)
    hook.rerender({ request: { ...initial, tab: 'lineSummary' } })
    await waitFor(() => expect(hook.result.current.first.isFetching).toBe(false))
    expect(rpc).toHaveBeenCalledTimes(2)
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); onlineManager.setOnline(false); onlineManager.setOnline(true) })
    expect(rpc).toHaveBeenCalledTimes(2)
    await act(async () => { scheduleWeldDataRefresh(client) })
    await waitFor(() => expect(hook.result.current.first.isFetching).toBe(false))
    expect(rpc).toHaveBeenCalledTimes(3)
    expect(rpc.mock.calls.map(([args]) => args.data.tab)).toEqual(['general', 'lineSummary', 'lineSummary'])
    hook.rerender({ request: initial })
    await waitFor(() => expect(hook.result.current.first.isFetching).toBe(false))
    expect(rpc).toHaveBeenCalledTimes(4)
  } finally {
    hook.unmount(); client.clear(); focusManager.setFocused(undefined); onlineManager.setOnline(true)
  }
})
