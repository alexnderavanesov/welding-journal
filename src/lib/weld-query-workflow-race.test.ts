import { QueryClient, QueryObserver, type QueryKey } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  LNK_WORKFLOW_QUERY_KEY,
  LNK_WORKFLOW_ROWS_QUERY_KEY,
  PSTO_WORKFLOW_QUERY_KEY,
  PSTO_WORKFLOW_ROWS_QUERY_KEY,
  scheduleWeldDataRefresh,
} from '@/lib/weld-query-utils'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const oldRow = { id: 1, joint: 'F1', rowVersion: '10', preVikConclusion: 'OLD' } as WeldRow
const savedRow = { ...oldRow, rowVersion: '11', preVikConclusion: 'CORRECTED' }
const otherRow = { id: 2, joint: 'F2', rowVersion: '12' } as WeldRow
const families = [
  { name: 'LNK', rows: LNK_WORKFLOW_ROWS_QUERY_KEY, root: LNK_WORKFLOW_QUERY_KEY, refresh: { refetchLnkWorkflow: true } },
  { name: 'PSTO', rows: PSTO_WORKFLOW_ROWS_QUERY_KEY, root: PSTO_WORKFLOW_QUERY_KEY, refresh: { refetchPstoWorkflow: true } },
] as const

describe('a committed workflow correction wins over an earlier pending read', () => {
  for (const family of families) {
    for (const existing of [false, true]) it(`${family.name}: ${existing ? 'loaded refetch' : 'first page of a new search'} restarts only its active exact key`, async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const key: QueryKey = [...family.rows, { scope: 'resultRegistry', search: 'F1', offset: 50, limit: 51 }]
      const inactiveKey = [...family.rows, { scope: 'resultRegistry', search: 'OTHER', offset: 0, limit: 51 }]
      const inactiveRead = vi.fn(async () => [otherRow])
      await client.fetchQuery({ queryKey: inactiveKey, queryFn: inactiveRead, staleTime: Infinity })
      if (existing) client.setQueryData(key, [oldRow, otherRow])
      const previousRead = deferred<WeldRow[]>(), currentRead = deferred<WeldRow[]>()
      // A transport need not honour AbortSignal: its late response must still
      // be prevented from publishing the pre-commit snapshot into the cache.
      const read = vi.fn().mockImplementationOnce(() => previousRead.promise).mockImplementation(() => currentRead.promise)
      const observer = new QueryObserver<WeldRow[]>(client, { queryKey: key, queryFn: read, staleTime: Infinity })
      const close = observer.subscribe(() => {})
      if (existing) void observer.refetch()
      const invalidations = vi.spyOn(client, 'invalidateQueries')
      const refetches = vi.spyOn(client, 'refetchQueries')
      try {
        expect(read).toHaveBeenCalledTimes(1)
        expect(client.getQueryState(key)?.fetchStatus).toBe('fetching')
        expect(scheduleWeldDataRefresh(client, { upsertRows: [savedRow], deleteIds: [otherRow.id] })).toBeUndefined()
        // Existing data is patched synchronously. A new scoped page cannot be
        // fabricated from a mutation row without knowing its filter membership.
        expect(client.getQueryData(key)).toEqual(existing ? [savedRow] : undefined)
        previousRead.resolve([oldRow, otherRow])
        await previousRead.promise
        await Promise.resolve()
        await Promise.resolve()
        // This is the causal regression: the old response must not replace
        // the saved row, even before the fresh scoped page has arrived.
        expect(client.getQueryData(key)).toEqual(existing ? [savedRow] : undefined)
        expect(read).toHaveBeenCalledTimes(2)
        expect(refetches).toHaveBeenCalledWith({ queryKey: key, exact: true, type: 'active' })
        expect(invalidations).toHaveBeenCalledWith({ queryKey: family.root, refetchType: 'none' })
        expect(inactiveRead).toHaveBeenCalledOnce()

        currentRead.resolve([savedRow])
        await vi.waitFor(() => expect(client.getQueryState(key)?.fetchStatus).toBe('idle'))
        expect(client.getQueryData(key)).toEqual([savedRow])
        expect(observer.getCurrentResult().data).toEqual([savedRow])
        expect(read).toHaveBeenCalledTimes(2)
        expect(inactiveRead).toHaveBeenCalledOnce()
      } finally {
        close(); client.clear()
      }
    })

    it(`${family.name}: an inactive pending query cannot republish old data or start a background reload`, async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const key = [...family.rows, { scope: 'resultRegistry', search: 'F1', offset: 0, limit: 51 }]
      const previousRead = deferred<WeldRow[]>()
      const read = vi.fn().mockImplementationOnce(() => previousRead.promise).mockResolvedValue([savedRow])
      const observer = new QueryObserver<WeldRow[]>(client, { queryKey: key, queryFn: read, staleTime: Infinity })
      const close = observer.subscribe(() => {})
      close()
      try {
        expect(client.getQueryState(key)?.fetchStatus).toBe('fetching')
        scheduleWeldDataRefresh(client, { upsertRows: [savedRow] })
        previousRead.resolve([oldRow])
        await previousRead.promise
        await Promise.resolve()
        await Promise.resolve()
        expect(read).toHaveBeenCalledOnce()
        expect(client.getQueryData(key)).toBeUndefined()
        expect(client.getQueryState(key)?.isInvalidated).toBe(true)
        const reopened = observer.subscribe(() => {})
        try {
          await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual([savedRow]))
          expect(read).toHaveBeenCalledTimes(2)
        } finally { reopened() }
      } finally { client.clear() }
    })

    it(`${family.name}: an explicit active refresh does not restart an interrupted query twice`, async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const key = [...family.rows, { scope: 'resultRegistry', search: 'F1', offset: 0, limit: 51 }]
      const previousRead = deferred<WeldRow[]>(), currentRead = deferred<WeldRow[]>()
      const read = vi.fn().mockImplementationOnce(() => previousRead.promise).mockImplementation(() => currentRead.promise)
      const observer = new QueryObserver<WeldRow[]>(client, { queryKey: key, queryFn: read })
      const close = observer.subscribe(() => {})
      try {
        expect(read).toHaveBeenCalledOnce()
        scheduleWeldDataRefresh(client, { upsertRows: [savedRow] }, family.refresh)
        expect(read).toHaveBeenCalledTimes(2)
        currentRead.resolve([savedRow])
        await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual([savedRow]))
        previousRead.resolve([oldRow])
        await previousRead.promise
        await Promise.resolve()
        await Promise.resolve()
        expect(client.getQueryData(key)).toEqual([savedRow])
        expect(read).toHaveBeenCalledTimes(2)
      } finally { close(); client.clear() }
    })

    it(`${family.name}: settled active and inactive pages are patched without extra reads`, async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const key = [...family.rows, { scope: 'resultRegistry', search: 'F1' }]
      const inactiveKey = [...family.rows, { scope: 'resultRegistry', search: 'F' }]
      const read = vi.fn(async () => [oldRow])
      await client.fetchQuery({ queryKey: key, queryFn: read, staleTime: Infinity })
      await client.fetchQuery({ queryKey: inactiveKey, queryFn: read, staleTime: Infinity })
      const observer = new QueryObserver<WeldRow[]>(client, { queryKey: key, queryFn: read, staleTime: Infinity })
      const close = observer.subscribe(() => {})
      try {
        scheduleWeldDataRefresh(client, { upsertRows: [savedRow] })
        expect(client.getQueryData(key)).toEqual([savedRow])
        expect(client.getQueryData(inactiveKey)).toEqual([savedRow])
        await Promise.resolve()
        expect(read).toHaveBeenCalledTimes(2)
      } finally { close(); client.clear() }
    })
  }
})
