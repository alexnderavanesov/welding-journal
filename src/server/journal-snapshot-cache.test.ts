import { afterEach, expect, it, vi } from 'vitest'
import { createJournalSnapshotCache } from './journal-snapshot-cache'
afterEach(() => vi.useRealTimers())
it('bounds aggregate bytes with LRU eviction, expires and ignores oversized entries', () => {
  vi.useFakeTimers()
  const cache = createJournalSnapshotCache<string>({ bytes: 6, ttlMs: 100, weigh: value => value.length })
  cache.put('a', 'aaa'); cache.put('b', 'bb'); expect(cache.get('a')).toBe('aaa')
  cache.put('c', 'cc'); expect(cache.get('b')).toBeUndefined(); expect(cache.stats()).toEqual({ bytes: 5, entries: 2 })
  cache.put('big', '1234567'); expect(cache.get('big')).toBeUndefined()
  vi.advanceTimersByTime(100); expect(cache.get('a')).toBeUndefined(); expect(cache.get('c')).toBeUndefined()
  expect(cache.stats()).toEqual({ bytes: 0, entries: 0 })
})
it('coalesces concurrent loads, and retries after failed computation', async () => {
  const cache = createJournalSnapshotCache<string>({ bytes: 100, weigh: value => value.length })
  let finish!: (value: string) => void
  const compute = vi.fn(() => new Promise<string>(resolve => { finish = resolve }))
  const a = cache.load('a', compute), b = cache.load('a', compute)
  finish('value'); expect(await a).toBe('value'); expect(await b).toBe('value'); expect(compute).toHaveBeenCalledOnce()
  expect(await cache.load('a', compute)).toBe('value'); expect(compute).toHaveBeenCalledOnce()
  const retry = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('ok')
  await expect(cache.load('b', retry)).rejects.toThrow('offline')
  expect(await cache.load('b', retry)).toBe('ok')
})
