import { expect, it, vi } from 'vitest'
import { createJournalCountCache } from './journal-count-cache'

it('coalesces concurrent blocks, but never carries a count into another revision or filter', async () => {
  const cache = createJournalCountCache()
  const read = vi.fn().mockResolvedValueOnce(200000).mockResolvedValueOnce(199999).mockResolvedValueOnce(12)
  expect(await Promise.all([cache('revision1/filterA', read), cache('revision1/filterA', read)])).toEqual([200000,200000])
  expect(read).toHaveBeenCalledTimes(1)
  expect(await cache('revision2/filterA',read)).toBe(199999)
  expect(await cache('revision2/filterB',read)).toBe(12)
})
it('allows retry after a rejected database count and bounds retained selections', async () => {
  const cache=createJournalCountCache(2)
  const read=vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(10)
  await expect(cache('A',read)).rejects.toThrow('database unavailable')
  expect(await cache('A',read)).toBe(10)
  await cache('B',read); await cache('C',read); await cache('A',read)
  expect(read).toHaveBeenCalledTimes(5)
})
