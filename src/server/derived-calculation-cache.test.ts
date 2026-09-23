import { describe, expect, it, vi } from 'vitest'
import { buildDerivedCalculationCacheKey } from '@/lib/derived-calculation-cache-key'
import { readCacheSnapshotCoalesced } from '@/server/derived-calculation-cache'

describe('derived calculation cache keys', () => {
  it('does not depend on object key order', () => {
    expect(
      buildDerivedCalculationCacheKey('statistics:v1', {
        tab: 'general',
        filters: { project: 'a', lines: ['2', '1'] },
      }),
    ).toBe(
      buildDerivedCalculationCacheKey('statistics:v1', {
        filters: { lines: ['2', '1'], project: 'a' },
        tab: 'general',
      }),
    )
  })

  it('keeps different arrays and namespaces separate', () => {
    const first = buildDerivedCalculationCacheKey('statistics:v1', { lines: ['1', '2'] })
    const second = buildDerivedCalculationCacheKey('statistics:v1', { lines: ['2', '1'] })
    const otherNamespace = buildDerivedCalculationCacheKey('dispatcher:v1', { lines: ['1', '2'] })

    expect(first).not.toBe(second)
    expect(first).not.toBe(otherNamespace)
  })
})

describe('derived calculation cache request coalescing', () => {
  it('uses one database snapshot read for concurrent requests with the same key', async () => {
    let resolveRead: ((value: { sourceRevision: number; payload: string | null }) => void) | undefined
    const read = vi.fn(() => new Promise<{ sourceRevision: number; payload: string | null }>((resolve) => {
      resolveRead = resolve
    }))
    const key = `coalesced-${Date.now()}-${Math.random()}`

    const first = readCacheSnapshotCoalesced(key, read)
    const second = readCacheSnapshotCoalesced(key, read)
    resolveRead?.({ sourceRevision: 17, payload: null })

    await expect(Promise.all([first, second])).resolves.toEqual([
      { sourceRevision: 17, payload: null },
      { sourceRevision: 17, payload: null },
    ])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('does not merge reads for different cache keys', async () => {
    const read = vi.fn(async (cacheKey: string) => ({ sourceRevision: 4, payload: cacheKey }))
    const prefix = `separate-${Date.now()}-${Math.random()}`

    await Promise.all([
      readCacheSnapshotCoalesced(`${prefix}-first`, read),
      readCacheSnapshotCoalesced(`${prefix}-second`, read),
    ])

    expect(read).toHaveBeenCalledTimes(2)
  })
})
