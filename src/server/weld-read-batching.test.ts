import { describe, expect, it, vi } from 'vitest'

import { loadWeldRowsByIdsInBatches } from '@/server/weld-read'

describe('weld row batch loading', () => {
  it('loads large ID selections with one array-bound query', async () => {
    let activeQueries = 0
    let maxActiveQueries = 0
    const query = vi.fn(async () => {
      activeQueries += 1
      maxActiveQueries = Math.max(maxActiveQueries, activeQueries)
      await Promise.resolve()
      activeQueries -= 1
      return []
    })
    const db = {
      select: () => ({
        from: () => ({
          where: query,
        }),
      }),
    }

    await loadWeldRowsByIdsInBatches(
      db as never,
      Array.from({ length: 2_001 }, (_, index) => index + 1),
    )

    expect(query).toHaveBeenCalledTimes(1)
    expect(maxActiveQueries).toBe(1)
  })
})
