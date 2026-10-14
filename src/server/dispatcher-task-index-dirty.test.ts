import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { getLineProgramIdentityKey } from '@/lib/line-program'
import { LINE_PROGRAM_OVERVIEW_CACHE_PREFIX } from './derived-calculation-cache'
import { DERIVED_CALCULATION_CACHE_VERSION } from '@/lib/derived-calculation-cache-version'
import {
  getDispatcherDirtyScopes,
  markDispatcherTaskIndexDirty,
  invalidateDerivedCalculationCache,
} from '@/server/dispatcher-task-index-dirty'

describe('markDispatcherTaskIndexDirty', () => {
  it('changes dispatcher and calculation revisions in one locked database operation', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)

    await markDispatcherTaskIndexDirty({ execute })

    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('keeps old and new weld line scopes distinct and removes exact duplicates', () => {
    const scopes = getDispatcherDirtyScopes(
      [
        { projectTitle: 'Project', subtitleCode: '400', line: 'L-2' },
        { projectTitle: 'Project', subtitleCode: '400', line: 'L-2' },
      ],
      new Map([[1, { projectTitle: 'Project', subtitleCode: '400', line: 'L-1' }]]),
    )

    expect(scopes).toEqual([
      { projectTitle: 'Project', subtitleCode: '400', line: 'L-2' },
      { projectTitle: 'Project', subtitleCode: '400', line: 'L-1' },
    ])
  })
})

describe('line overview retention during central invalidation', () => {
  const scope = { projectTitle: ' Проект ', subtitleCode: ' S ', line: ' Линия 1 ' }
  const render = (query: SQL) => new PgDialect().sqlToQuery(query)
  async function capture(run: (db: { execute: (query: SQL) => Promise<unknown> }) => Promise<void>) {
    const execute = vi.fn(async (_query: SQL) => undefined)
    await run({ execute })
    expect(execute).toHaveBeenCalledOnce()
    return render(execute.mock.calls[0][0])
  }

  it('promotes only the immediately previous revision in the current namespace, using explicit envelope identity', async () => {
    const query = await capture(db => markDispatcherTaskIndexDirty(db, { scopes: [scope] }))
    expect(query.sql).toContain('returning "source_revision"')
    expect(query.sql).toContain('cache."source_revision" = state."source_revision" - 1')
    expect(query.sql).not.toMatch(/cache\."source_revision"\s*[<>]/)
    expect(query.sql).toContain('cache."payload" is json object')
    expect(query.sql).toContain("jsonb_typeof(cache.\"payload\"::jsonb -> 'identityKey') = 'string'")
    expect(query.sql).toContain("cache.\"payload\"::jsonb ->> 'namespace'")
    expect(query.params).toContain(LINE_PROGRAM_OVERVIEW_CACHE_PREFIX + '%')
    expect(query.params).toContain(LINE_PROGRAM_OVERVIEW_CACHE_PREFIX)
    expect(query.params).toContainEqual([getLineProgramIdentityKey(scope)])
    expect(query.sql).toContain('"cache_key" not in (select "cache_key" from "retained_overviews")')
    expect(query.sql).not.toMatch(/split_part|substring/)
  })

  it('does not promote an expired rule or namespace prefix regardless of how high source revision has grown', async () => {
    const query = await capture(db => invalidateDerivedCalculationCache(db, { preserveLineOverviews: true }))
    const prefixes = query.params.filter(value => typeof value === 'string')
    expect(prefixes).toEqual([
      `line-program-overview:v1:rules:v${DERIVED_CALCULATION_CACHE_VERSION}:%`,
      `line-program-overview:v1:rules:v${DERIVED_CALCULATION_CACHE_VERSION}:`,
    ])
    expect(query.sql).not.toContain('greatest(')
    expect(query.sql).toContain('"cache_key" not in (select "cache_key" from "retained_overviews")')
  })

  it('invalidates both old and new identities on move and deduplicates lower/trim equivalents', async () => {
    const previous = { ...scope, line: 'Old' }
    const scopes = getDispatcherDirtyScopes([scope, { ...scope, projectTitle: 'ПРОЕКТ', line: 'линия 1' }], new Map([[1, previous]]))
    const query = await capture(db => markDispatcherTaskIndexDirty(db, { scopes }))
    expect(query.params.at(-1)).toEqual([getLineProgramIdentityKey(scope), getLineProgramIdentityKey(previous)])
  })

  it('retains the deleted last row identity even without a surviving FK/registry lookup', async () => {
    const query = await capture(db => markDispatcherTaskIndexDirty(db, {
      scopes: getDispatcherDirtyScopes([], new Map([[1, scope]])),
    }))
    expect(query.params.at(-1)).toEqual([getLineProgramIdentityKey(scope)])
    expect(query.sql).not.toContain('line_program_id')
    expect(query.sql).not.toContain('from "weld_joints"')
  })

  it('keeps full clear as the default and for fullRebuild even with scopes', async () => {
    for (const run of [
      (db: Parameters<typeof markDispatcherTaskIndexDirty>[0]) => markDispatcherTaskIndexDirty(db),
      (db: Parameters<typeof markDispatcherTaskIndexDirty>[0]) => markDispatcherTaskIndexDirty(db, { scopes: [scope], fullRebuild: true }),
      (db: Parameters<typeof markDispatcherTaskIndexDirty>[0]) => invalidateDerivedCalculationCache(db),
    ]) {
      const query = await capture(run)
      expect(query.sql).not.toContain('retained_overviews')
      expect(query.sql).toContain('delete from "derived_calculation_cache" where exists')
    }
  })

  it('allows explicit finalStatus/WDI preservation but still deletes aggregate/report caches', async () => {
    const query = await capture(db => invalidateDerivedCalculationCache(db, { preserveLineOverviews: true }))
    expect(query.params.at(-1)).toEqual([])
    expect(query.sql).toContain('cache."source_revision" = state."source_revision" - 1')
    expect(query.sql).toContain('"cache_key" not in (select "cache_key" from "retained_overviews")')
    expect(query.params).toContain(LINE_PROGRAM_OVERVIEW_CACHE_PREFIX + '%')
  })

  it('retains overviews for explicit reminder-only empty scopes, never for implicit empty/full scopes', async () => {
    const reminder = await capture(db => markDispatcherTaskIndexDirty(db, { scopes: [], fullRebuild: false }))
    expect(reminder.params.at(-1)).toEqual([])
    const unknown = await capture(db => markDispatcherTaskIndexDirty(db, { scopes: [] }))
    expect(unknown.sql).not.toContain('retained_overviews')
  })
})
