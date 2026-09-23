import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

import {
  getChangedWeldLineMemberships,
  getWeldLineMembershipLockKeys,
  haveSameWeldLineMemberships,
  lockWeldLineMemberships,
} from '@/server/weld-line-membership-lock'

describe('weld line membership lock', () => {
  it('normalizes, deduplicates and sorts line identities', () => {
    expect(getWeldLineMembershipLockKeys([
      { projectTitle: ' P ', subtitleCode: 'S', line: ' L2 ' },
      { projectTitle: 'P', subtitleCode: 'S', line: 'L1' },
      { projectTitle: 'P', subtitleCode: 'S', line: 'L2' },
      { projectTitle: 'P', subtitleCode: 'S', line: '   ' },
    ])).toEqual([
      'weld-line-membership:["p","s","l1"]',
      'weld-line-membership:["p","s","l2"]',
    ])
  })

  it('locks all identities in one ordered database query', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)

    await lockWeldLineMemberships({ execute }, [
      { projectTitle: 'P', subtitleCode: 'S', line: 'L2' },
      { projectTitle: 'P', subtitleCode: 'S', line: 'L1' },
    ])

    expect(execute).toHaveBeenCalledTimes(1)
    const query = execute.mock.calls[0]?.[0]
    const compiled = new PgDialect().sqlToQuery(query!)
    expect(compiled.sql).toContain('pg_advisory_xact_lock')
    expect(compiled.sql).toContain('order by')
    expect(compiled.params).toEqual([[
      'weld-line-membership:["p","s","l1"]',
      'weld-line-membership:["p","s","l2"]',
    ]])
  })

  it('locks production-sized line selections in one ordered query', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)

    await lockWeldLineMemberships(
      { execute },
      Array.from({ length: 2_001 }, (_, index) => ({
        projectTitle: 'P',
        subtitleCode: 'S',
        line: `L${String(index + 1).padStart(4, '0')}`,
      })),
    )

    expect(execute).toHaveBeenCalledTimes(1)
    const dialect = new PgDialect()
    const [parameters] = dialect.sqlToQuery(execute.mock.calls[0]![0]).params as [string[]]
    expect(parameters).toEqual([...parameters].sort())
  })

  it('returns both sides only when line membership changes', () => {
    const previous = { projectTitle: 'P', subtitleCode: 'S', line: 'L1' }
    expect(getChangedWeldLineMemberships(previous, { ...previous })).toEqual([])
    expect(getChangedWeldLineMemberships(previous, {
      projectTitle: 'p',
      subtitleCode: 's',
      line: 'l1',
    })).toEqual([])
    expect(getChangedWeldLineMemberships(previous, { ...previous, line: 'L2' })).toEqual([
      previous,
      { ...previous, line: 'L2' },
    ])
  })

  it('detects a concurrent line move after the membership lock snapshot', () => {
    const snapshot = [
      { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L1' },
      { id: 2, projectTitle: 'P', subtitleCode: 'S', line: 'L1' },
    ]

    expect(haveSameWeldLineMemberships(snapshot, snapshot)).toBe(true)
    expect(haveSameWeldLineMemberships(snapshot, [
      snapshot[0],
      { ...snapshot[1], line: 'L2' },
    ])).toBe(false)
    expect(haveSameWeldLineMemberships(snapshot, [snapshot[0]])).toBe(false)
  })
})
