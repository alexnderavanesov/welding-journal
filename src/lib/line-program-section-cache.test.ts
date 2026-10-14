import { MutationObserver, QueryClient, QueryObserver, type QueryKey } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { updateLineProgramSectionCaches } from './line-program-section-cache'

const legacyKey = ['line-program', 'section'] as const
const sectionKey = ['line-program', 'section', 'percentage', 'STAMP'] as const
const pageKey = ['line-program', 'page', 'percentage', 'STAMP', 0] as const
const listKeys = [legacyKey, sectionKey, pageKey]
type Summary = Required<Parameters<typeof updateLineProgramSectionCaches>[1]>
const line: Summary = {
  id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L1', category: 'II', groupName: 'A',
  weldControlPercent: 30, pvkControlPercent: 10, configurationIssue: null, version: 'before', searchStamps: ['STAMP'],
  overview: { joints: 3, calculationJoints: 3, stamps: 1, additional: 0, approved: 0, reducible: 0, pending: 3, rejected: 0,
    common: { required: 1, covered: 0, missing: 1, actionableRequired: 1, excess: 0 }, pvk: null },
}
const saved: Summary = { ...line, version: 'after', overview: { ...line.overview,
  approved: 1, common: { required: 1, covered: 1, missing: 0, actionableRequired: 1, excess: 0 } } }
const other = { ...line, id: 2, line: 'L2' }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

let client: QueryClient
let subscriptions: Array<() => void>
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  subscriptions = []
})
afterEach(() => { subscriptions.forEach(unsubscribe => unsubscribe()); client.clear() })

function observe<T>(queryKey: QueryKey, queryFn: () => Promise<T>) {
  const observer = new QueryObserver(client, { queryKey, queryFn })
  subscriptions.push(observer.subscribe(() => {}))
  return observer
}

describe('line program section and page cache reconciliation', () => {
  it('patches only containing snapshots, preserving legacy, page metadata and unrelated row fields', async () => {
    const snapshot = { rows: [{ ...line, displayHint: 'keep' }, other], total: 61, page: 1, pageSize: 30,
      hasMore: true, context: { tab: 'percentage', search: 'STAMP' } }
    for (const key of listKeys) client.setQueryData(key, snapshot)
    const absentKey = ['line-program', 'section', 'full', 'OTHER']
    const absent = { rows: [other], total: 1 }
    client.setQueryData(absentKey, absent)
    const detailKey = ['line-program', 'rows', line.id]
    client.setQueryData(detailKey, snapshot)
    const externalKey = ['another-feature', 'section']
    client.setQueryData(externalKey, snapshot)
    // The helper also handles snapshots invalidated by an earlier external edit.
    await client.invalidateQueries({ queryKey: ['line-program'], refetchType: 'none' })
    const count = client.getQueryCache().getAll().length

    await updateLineProgramSectionCaches(client, saved)

    for (const key of listKeys) {
      const result = client.getQueryData<typeof snapshot>(key)!
      expect(result).toEqual({ ...snapshot, rows: [{ ...saved, displayHint: 'keep' }, other] })
      expect(result.context).toBe(snapshot.context)
      expect(result.rows[1]).toBe(other)
      expect(client.getQueryState(key)?.isInvalidated).toBe(false)
    }
    expect(client.getQueryData(absentKey)).toBe(absent)
    expect(client.getQueryState(absentKey)?.isInvalidated).toBe(true)
    expect(client.getQueryData(detailKey)).toBe(snapshot)
    expect(client.getQueryData(externalKey)).toBe(snapshot)
    expect(client.getQueryCache().getAll()).toHaveLength(count)
  })

  it('does not create a legacy base or insert a line into an unrelated or empty selection', async () => {
    client.setQueryData(pageKey, { rows: [], total: 0, page: 0 })
    client.setQueryData(sectionKey, { rows: [other] })
    await updateLineProgramSectionCaches(client, saved)
    expect(client.getQueryData(pageKey)).toEqual({ rows: [], total: 0, page: 0 })
    expect(client.getQueryData(sectionKey)).toEqual({ rows: [other] })
    expect(client.getQueryState(legacyKey)).toBeUndefined()
    expect(client.getQueryCache().getAll()).toHaveLength(2)
  })

  it('updates active and inactive summaries without refetching either selection', async () => {
    const activeRead = vi.fn(async () => ({ rows: [line] }))
    const inactiveRead = vi.fn(async () => ({ rows: [line], total: 1, page: 0 }))
    await client.fetchQuery({ queryKey: sectionKey, queryFn: activeRead })
    await client.fetchQuery({ queryKey: pageKey, queryFn: inactiveRead })
    observe(sectionKey, activeRead)
    await client.invalidateQueries({ queryKey: ['line-program'], refetchType: 'none' })

    await updateLineProgramSectionCaches(client, saved)

    expect(activeRead).toHaveBeenCalledTimes(1)
    expect(inactiveRead).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(sectionKey)).toEqual({ rows: [saved] })
    expect(client.getQueryData(pageKey)).toEqual({ rows: [saved], total: 1, page: 0 })
  })

  it.each(listKeys.map(queryKey => ({ queryKey })))('cancels an in-flight $queryKey read before patching, ignoring its late response', async ({ queryKey }) => {
    const snapshot = { rows: [line], total: 61, page: 0 }
    client.setQueryData(queryKey, snapshot)
    const oldRead = deferred<typeof snapshot>()
    let signal: AbortSignal | undefined
    const queryFn = vi.fn((context: { signal: AbortSignal }) => { signal = context.signal; return oldRead.promise })
    const observer = new QueryObserver(client, { queryKey, queryFn })
    subscriptions.push(observer.subscribe(() => {}))
    const running = observer.refetch()
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(client.getQueryState(queryKey)?.fetchStatus).toBe('fetching')

    await updateLineProgramSectionCaches(client, saved)

    expect(signal?.aborted).toBe(true)
    expect(client.getQueryData(queryKey)).toEqual({ ...snapshot, rows: [saved] })
    oldRead.resolve(snapshot)
    await running
    await oldRead.promise
    expect(client.getQueryData(queryKey)).toEqual({ ...snapshot, rows: [saved] })
    expect(client.getQueryState(queryKey)?.fetchStatus).toBe('idle')
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it.each([sectionKey, pageKey].map(queryKey => ({ queryKey })))('restarts a cancelled initial active $queryKey read without inventing its selection', async ({ queryKey }) => {
    const oldRead = deferred<{ rows: Summary[]; total: number; page: number }>()
    const fresh = { rows: [other, saved], total: 2, page: 0 }
    const queryFn = vi.fn().mockImplementationOnce(() => oldRead.promise).mockResolvedValue(fresh)
    observe(queryKey, queryFn)
    expect(queryFn).toHaveBeenCalledTimes(1)

    await updateLineProgramSectionCaches(client, saved)

    expect(queryFn).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(client.getQueryData(queryKey)).toEqual(fresh))
    oldRead.resolve({ rows: [line], total: 1, page: 0 })
    await oldRead.promise
    expect(client.getQueryData(queryKey)).toEqual(fresh)
    expect(client.getQueryState(queryKey)?.fetchStatus).toBe('idle')
  })

  it.each([legacyKey, sectionKey].map(queryKey => ({ queryKey })))('completes saving after scoped details while the initial $queryKey summary stays pending, ignoring the old response', async ({ queryKey }) => {
    const queryClient = client
    const oldRead = deferred<{ rows: Summary[] }>()
    const fullRead = deferred<{ rows: Summary[] }>()
    const summaryFn = vi.fn().mockImplementationOnce(() => oldRead.promise).mockImplementation(() => fullRead.promise)
    observe(queryKey, summaryFn)
    client.setQueryData(pageKey, { rows: [line], total: 90, page: 0 })

    const detailKey = ['line-program', 'rows', line.id]
    const detailRead = deferred<{ rows: Array<{ id: number; hasRk: string }> }>()
    const detailFn = vi.fn(() => detailRead.promise)
    client.setQueryData(detailKey, { rows: [{ id: 7, hasRk: '' }] })
    observe(detailKey, detailFn)
    const mutation = new MutationObserver(client, {
      mutationFn: async () => saved,
      onSuccess: async result => {
        await updateLineProgramSectionCaches(queryClient, result)
        await queryClient.invalidateQueries({ queryKey: detailKey, exact: true, refetchType: 'active' })
      },
    })

    const saving = mutation.mutate()
    await vi.waitFor(() => expect(detailFn).toHaveBeenCalledTimes(1))
    expect(summaryFn).toHaveBeenCalledTimes(2)
    expect(mutation.getCurrentResult().isPending).toBe(true)
    expect(client.getQueryData(pageKey)).toEqual({ rows: [saved], total: 90, page: 0 })
    expect(client.getQueryState(queryKey)).toMatchObject({ status: 'pending', fetchStatus: 'fetching' })

    detailRead.resolve({ rows: [{ id: 7, hasRk: 'да' }] })
    await saving
    expect(mutation.getCurrentResult().isSuccess).toBe(true)
    expect(client.getQueryData(detailKey)).toEqual({ rows: [{ id: 7, hasRk: 'да' }] })
    expect(client.getQueryData(queryKey)).toBeUndefined()
    expect(client.getQueryState(queryKey)?.fetchStatus).toBe('fetching')

    oldRead.resolve({ rows: [line] })
    await oldRead.promise
    expect(client.getQueryData(queryKey)).toBeUndefined()
    expect(client.getQueryData(pageKey)).toEqual({ rows: [saved], total: 90, page: 0 })
    fullRead.resolve({ rows: [saved, other] })
    await vi.waitFor(() => expect(client.getQueryData(queryKey)).toEqual({ rows: [saved, other] }))
  })

  it('cancels an initial inactive read without refetching it or manufacturing a partial page', async () => {
    const oldRead = deferred<{ rows: Summary[] }>()
    const queryFn = vi.fn(() => oldRead.promise)
    const running = client.fetchQuery({ queryKey: pageKey, queryFn }).catch(error => error)
    await updateLineProgramSectionCaches(client, saved)
    oldRead.resolve({ rows: [line] })
    await running
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(pageKey)).toBeUndefined()
    expect(client.getQueryState(pageKey)).toMatchObject({ fetchStatus: 'idle', isInvalidated: true })
  })

  it('refreshes active memberships and totals after rename in the background and leaves inactive selections stale', async () => {
    const renamed = { ...saved, line: 'NEW', weldControlPercent: 100, pvkControlPercent: 100 }
    const activeSection = ['line-program', 'section', 'percentage', 'L1']
    const activePage = ['line-program', 'page', 'full', 'NEW', 0]
    const oldSnapshot = { rows: [line], total: 1, page: 0, hint: 'keep' }
    client.setQueryData(legacyKey, oldSnapshot)
    client.setQueryData(activeSection, oldSnapshot)
    client.setQueryData(activePage, { rows: [], total: 0, page: 0 })
    const sectionRead = deferred<typeof oldSnapshot>()
    const pageRead = deferred<{ rows: Summary[]; total: number; page: number }>()
    const sectionFn = vi.fn(() => sectionRead.promise), pageFn = vi.fn(() => pageRead.promise)
    observe(activeSection, sectionFn)
    observe(activePage, pageFn)
    const inactiveFn = vi.fn(async () => oldSnapshot)
    await client.fetchQuery({ queryKey: legacyKey, queryFn: inactiveFn })
    await updateLineProgramSectionCaches(client, renamed, { membershipChanged: true })

    expect(pageFn).toHaveBeenCalledTimes(1)
    expect(sectionFn).toHaveBeenCalledTimes(1)
    expect(client.getQueryData<typeof oldSnapshot>(activeSection)?.rows[0].version).toBe('after')
    expect(client.getQueryState(activeSection)?.fetchStatus).toBe('fetching')
    expect(client.getQueryState(activePage)?.fetchStatus).toBe('fetching')
    sectionRead.resolve({ ...oldSnapshot, rows: [], total: 0 })
    await vi.waitFor(() => expect(client.getQueryData(activeSection)).toEqual({ ...oldSnapshot, rows: [], total: 0 }))
    expect(client.getQueryState(activePage)?.fetchStatus).toBe('fetching')
    pageRead.resolve({ rows: [renamed], total: 1, page: 0 })
    await vi.waitFor(() => expect(client.getQueryData(activePage)).toEqual({ rows: [renamed], total: 1, page: 0 }))

    expect(client.getQueryData(activeSection)).toEqual({ ...oldSnapshot, rows: [], total: 0 })
    expect(client.getQueryData(activePage)).toEqual({ rows: [renamed], total: 1, page: 0 })
    expect(client.getQueryData(legacyKey)).toEqual({ ...oldSnapshot, rows: [renamed] })
    expect(client.getQueryState(legacyKey)?.isInvalidated).toBe(true)
    expect(inactiveFn).not.toHaveBeenCalled()
  })

  it('retains the new version and metadata when the active membership refresh fails', async () => {
    const snapshot = { rows: [line], total: 61, page: 0 }
    client.setQueryData(pageKey, snapshot)
    const failedRead = vi.fn(async () => { throw new Error('Offline') })
    observe(pageKey, failedRead)
    await updateLineProgramSectionCaches(client, { ...line, version: 'after' }, { membershipChanged: true })
    expect(client.getQueryData(pageKey)).toEqual({ ...snapshot, rows: [{ ...line, version: 'after' }] })
    await vi.waitFor(() => expect(client.getQueryState(pageKey)).toMatchObject({ status: 'error', isInvalidated: true, fetchStatus: 'idle' }))
    expect(failedRead).toHaveBeenCalledTimes(1)
  })
})
