import { describe, expect, it } from 'vitest'
import { buildDerivedCalculationCacheKey } from '@/server/derived-calculation-cache'

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
