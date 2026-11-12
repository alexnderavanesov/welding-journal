import type { PropsWithChildren } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { useStatisticsServerQuery } from './use-statistics-server-query'
import { scheduleWeldDataRefresh } from './weld-query-utils'
import type { StatisticsServerRequest } from './statistics-server-summary'
import { buildStatisticsServerResult } from './statistics-server-summary'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import { STATISTICS_RESULT_VERSION } from './statistics-result-version'

it('reloads a fresh pre-update cache instead of rendering missing composition and NaN coverage', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })
  const request: StatisticsServerRequest = { tab: 'lineSummary', unit: 'joints' }
  const current = buildStatisticsServerResult({ rows: [{ id: 1, line: 'L', joint: 'F1' }],
    welderStamps: [], systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS, request })
  const legacy = structuredClone(current) as unknown as { formatVersion?: number; lineSummary: { rows: Record<string, unknown>[] } }
  delete legacy.formatVersion
  for (const row of legacy.lineSummary.rows) {
    for (const key of ['lineKey', 'composition', 'physicalTotal', 'physicalCompleted', 'scheme']) delete row[key]
  }
  client.setQueryData(['statistics-server', request], legacy)
  rpc.mockClear()
  rpc.mockResolvedValueOnce(current as never)
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = renderHook(() => useStatisticsServerQuery(request), { wrapper })
  try {
    expect(hook.result.current.data).toBeUndefined()
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(hook.result.current.data?.lineSummary.rows[0]).toMatchObject({ physicalTotal: 1, composition: { f: { total: 1 } } })
  } finally { hook.unmount(); client.clear() }
})

const rpc = vi.hoisted(() => vi.fn(async ({ data }: { data: StatisticsServerRequest }) => ({ tab: data.tab, formatVersion: STATISTICS_RESULT_VERSION })))
vi.mock('@/server/statistics', () => ({ getStatisticsServerResult: rpc }))

it('reports an outdated server result without rendering it or retrying indefinitely', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  rpc.mockClear()
  rpc.mockResolvedValueOnce({ tab: 'lineSummary' } as never)
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = renderHook(() => useStatisticsServerQuery({ tab: 'lineSummary' }), { wrapper })
  try {
    await waitFor(() => expect(hook.result.current.isError).toBe(true))
    expect(hook.result.current.data).toBeUndefined()
    expect(hook.result.current.error?.message).toContain('Обновите страницу')
    expect(rpc).toHaveBeenCalledTimes(1)
  } finally { hook.unmount(); client.clear() }
})

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
