import { expect, it } from 'vitest'
import { createJournalLeafCache } from './journal-leaf-cache'
import type { JournalGridResult } from './journal-server-grid'
const result = (size: number): JournalGridResult => ({ revision: 1, rowCount: size, rows: Array.from({ length: size }, (_, id) => ({ id })) })
it('bounds retained cards, preserves recently reopened blocks and releases replaced entries', () => {
  const cache = createJournalLeafCache(5)
  cache.set('a', result(2)); cache.set('b', result(3))
  expect(cache.get('a')).toBeDefined()
  cache.set('c', result(1))
  expect(cache.get('b')).toBeUndefined()
  cache.set('a', result(4))
  expect(cache.get('c')).toBeDefined()
  cache.set('a', result(6))
  expect(cache.get('a')).toBeUndefined()
  expect(cache.get('c')).toBeDefined()
})
it('also bounds empty blocks and exposes invalidation to pending loads', () => {
  const cache = createJournalLeafCache()
  for (let i = 0; i < 30; i++) cache.set(String(i), result(0))
  expect(cache.get('0')).toBeUndefined()
  expect(cache.get('29')).toBeDefined()
  const generation = cache.generation
  cache.clear()
  expect(cache.generation).not.toBe(generation)
  expect(cache.get('29')).toBeUndefined()
})
