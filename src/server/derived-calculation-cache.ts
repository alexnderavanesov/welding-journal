import { createServerOnlyFn } from '@tanstack/react-start'
import { sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  derivedCalculationCache,
  derivedCalculationState,
} from '@/db/schema'
import { DERIVED_CALCULATION_CACHE_VERSION, DERIVED_CALCULATION_REVISION_FLOOR } from '@/lib/derived-calculation-cache-version'

const DERIVED_CALCULATION_STATE_ID = 1
const MAX_CACHED_CALCULATIONS = 96
export const LINE_PROGRAM_OVERVIEW_CACHE_FAMILY = 'line-program-overview:'
export const LINE_PROGRAM_OVERVIEW_CACHE_PREFIX = `${LINE_PROGRAM_OVERVIEW_CACHE_FAMILY}v1:rules:v${DERIVED_CALCULATION_CACHE_VERSION}:`
export const MAX_CACHED_LINE_PROGRAM_OVERVIEWS = 2000
export const DERIVED_CALCULATION_CACHE_WRITE_BATCH_SIZE = 500
const inFlightCalculations = new Map<string, Promise<unknown>>()
type DerivedCalculationCacheSnapshot = { sourceRevision: number; payload: string | null }
const inFlightSnapshotReads = new Map<string, Promise<DerivedCalculationCacheSnapshot>>()

export const getOrComputeDerivedCalculation = createServerOnlyFn(
  async function getOrComputeDerivedCalculationOnServer<T>(
    cacheKey: string,
    compute: () => Promise<T>,
  ): Promise<T> {
    const cacheSnapshot = await readCacheSnapshotCoalesced(cacheKey)
    const sourceRevision = cacheSnapshot.sourceRevision
    const inFlightKey = `${sourceRevision}:${cacheKey}`
    const existing = inFlightCalculations.get(inFlightKey)
    if (existing) return existing as Promise<T>

    const calculation = readOrCompute(cacheKey, sourceRevision, cacheSnapshot.payload, compute)
    inFlightCalculations.set(inFlightKey, calculation)
    try {
      return await calculation
    } finally {
      if (inFlightCalculations.get(inFlightKey) === calculation) {
        inFlightCalculations.delete(inFlightKey)
      }
    }
  },
)

async function readOrCompute<T>(
  cacheKey: string,
  sourceRevision: number,
  cachedPayload: string | null,
  compute: () => Promise<T>,
): Promise<T> {
  if (cachedPayload !== null) {
    try {
      return JSON.parse(cachedPayload) as T
    } catch {
      // Recompute and replace under the revision lock. An unconditional delete
      // here could remove a newer payload published after this snapshot read.
    }
  }

  const result = await compute()
  await writeDerivedCalculationCache(sourceRevision, [{ cacheKey, payload: JSON.stringify(result) }])
  return result
}

/** Publish outside a read-only calculation transaction. Every invalidator updates
 * this same state row before touching cache rows, so checking under FOR UPDATE
 * and holding the lock through publication closes the old check/upsert race. */
export async function writeDerivedCalculationCache(
  sourceRevision: number,
  entries: readonly { cacheKey: string; payload: string }[],
  partition: 'general' | 'line-overviews' = 'general',
) {
  if (!entries.length || !Number.isSafeInteger(sourceRevision) || sourceRevision < 0) return
  const isOverview = partition === 'line-overviews'
  if (entries.some(entry => isOverview
    ? !entry.cacheKey.startsWith(LINE_PROGRAM_OVERVIEW_CACHE_PREFIX)
    : entry.cacheKey.startsWith(LINE_PROGRAM_OVERVIEW_CACHE_FAMILY))) {
    throw new Error('Invalid derived cache namespace for publication')
  }
  const limit = isOverview ? MAX_CACHED_LINE_PROGRAM_OVERVIEWS : MAX_CACHED_CALCULATIONS
  const bounded = [...new Map(entries.map(entry => [entry.cacheKey, entry])).values()].slice(-limit)
  await requireDb().transaction(async tx => {
    const state = await tx.execute<{ sourceRevision: number }>(sql`
      select "source_revision" as "sourceRevision" from ${derivedCalculationState}
      where "id" = ${DERIVED_CALCULATION_STATE_ID} for update
    `)
    if (state.rows[0]?.sourceRevision !== sourceRevision) return
    const computedAt = new Date()
    for (let offset = 0; offset < bounded.length; offset += DERIVED_CALCULATION_CACHE_WRITE_BATCH_SIZE) {
      await tx.insert(derivedCalculationCache)
        .values(bounded.slice(offset, offset + DERIVED_CALCULATION_CACHE_WRITE_BATCH_SIZE)
          .map(entry => ({ ...entry, sourceRevision, computedAt })))
        .onConflictDoUpdate({ target: derivedCalculationCache.cacheKey, set: {
          sourceRevision: sql`excluded."source_revision"`,
          payload: sql`excluded."payload"`,
          computedAt: sql`excluded."computed_at"`,
        }, setWhere: sql`${derivedCalculationCache.sourceRevision} <= excluded."source_revision"` })
    }
    const partitionWhere = isOverview
      ? sql`"cache_key" like ${LINE_PROGRAM_OVERVIEW_CACHE_FAMILY + '%'}`
      : sql`"cache_key" not like ${LINE_PROGRAM_OVERVIEW_CACHE_FAMILY + '%'}`
    await tx.execute(sql`
      delete from ${derivedCalculationCache} where "cache_key" in (
        select "cache_key" from ${derivedCalculationCache} where ${partitionWhere}
        order by "computed_at" desc, "cache_key" asc offset ${limit}
      )
    `)
  })
}

async function readCacheSnapshot(cacheKey: string) {
  const result = await requireDb().execute<{ sourceRevision: number | string; payload: string | null }>(sql`
    with "ensure_state" as (
      insert into ${derivedCalculationState} ("id", "source_revision", "updated_at")
      values (${DERIVED_CALCULATION_STATE_ID}, ${DERIVED_CALCULATION_REVISION_FLOOR}, now())
      on conflict ("id") do update
      set
        "source_revision" = ${DERIVED_CALCULATION_REVISION_FLOOR},
        "updated_at" = now()
      where ${derivedCalculationState.sourceRevision} < ${DERIVED_CALCULATION_REVISION_FLOOR}
      returning "source_revision"
    ),
    "clear_outdated_cache" as (
      delete from ${derivedCalculationCache}
      where exists (select 1 from "ensure_state")
      returning "cache_key"
    ),
    "current_state" as (
      select "source_revision" from "ensure_state"
      union all
      select ${derivedCalculationState.sourceRevision}
      from ${derivedCalculationState}
      where ${derivedCalculationState.id} = ${DERIVED_CALCULATION_STATE_ID}
        and not exists (select 1 from "ensure_state")
    )
    select
      "current_state"."source_revision" as "sourceRevision",
      ${derivedCalculationCache.payload} as "payload"
    from "current_state"
    cross join (select count(*) from "clear_outdated_cache") as "cache_cleanup"
    left join ${derivedCalculationCache}
      on ${derivedCalculationCache.cacheKey} = ${cacheKey}
      and ${derivedCalculationCache.sourceRevision} = "current_state"."source_revision"
    limit 1
  `)
  const row = result.rows[0]
  return {
    sourceRevision: Number(row?.sourceRevision) || 0,
    payload: typeof row?.payload === 'string' ? row.payload : null,
  }
}

export async function readCacheSnapshotCoalesced(
  cacheKey: string,
  read: (cacheKey: string) => Promise<DerivedCalculationCacheSnapshot> = readCacheSnapshot,
) {
  const existing = inFlightSnapshotReads.get(cacheKey)
  if (existing) return existing

  const pending = read(cacheKey)
  inFlightSnapshotReads.set(cacheKey, pending)
  try {
    return await pending
  } finally {
    if (inFlightSnapshotReads.get(cacheKey) === pending) {
      inFlightSnapshotReads.delete(cacheKey)
    }
  }
}
