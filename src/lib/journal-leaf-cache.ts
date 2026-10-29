import type { JournalGridResult } from './journal-server-grid'

/** Recently viewed child blocks from one displayed snapshot. The query owner
 * clears this on any query/grouping/revision change or update notification.
 * AG Grid still releases closed stores; retained card count is strictly bounded. */
export function createJournalLeafCache(limit = 500) {
  const entries = new Map<string, JournalGridResult>()
  let cards = 0, generation = 0
  return {
    get generation() { return generation },
    clear() { entries.clear(); cards = 0; generation++ },
    get(key: string) {
      const value = entries.get(key)
      if (value) { entries.delete(key); entries.set(key, value) }
      return value
    },
    set(key: string, value: JournalGridResult) {
      const previous = entries.get(key)
      if (previous) { cards -= previous.rows.length; entries.delete(key) }
      if (value.rows.length > limit) return
      entries.set(key, value); cards += value.rows.length
      // Also bound empty responses and their keys.
      while (cards > limit || entries.size > 16) {
        const oldest = entries.keys().next().value!
        cards -= entries.get(oldest)!.rows.length; entries.delete(oldest)
      }
    },
  }
}
