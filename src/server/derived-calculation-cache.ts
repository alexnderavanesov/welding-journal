import { createServerOnlyFn } from '@tanstack/react-start'
import { eq, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  derivedCalculationCache,
  derivedCalculationState,
} from '@/db/schema'

const DERIVED_CALCULATION_STATE_ID = 1
const MAX_CACHED_CALCULATIONS = 96
const inFlightCalculations = new Map<string, Promise<unknown>>()

export const getOrComputeDerivedCalculation = createServerOnlyFn(
  async function getOrComputeDerivedCalculationOnServer<T>(
    cacheKey: string,
    compute: () => Promise<T>,
  ): Promise<T> {
    const cacheSnapshot = await readCacheSnapshot(cacheKey)
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
  const db = requireDb()
  if (cachedPayload !== null) {
    try {
      return JSON.parse(cachedPayload) as T
    } catch {
      await db
        .delete(derivedCalculationCache)
        .where(eq(derivedCalculationCache.cacheKey, cacheKey))
    }
  }

  const result = await compute()
  const currentRevision = await getSourceRevision()
  if (currentRevision === sourceRevision) {
    await db
      .insert(derivedCalculationCache)
      .values({
        cacheKey,
        sourceRevision,
        payload: JSON.stringify(result),
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: derivedCalculationCache.cacheKey,
        set: {
          sourceRevision,
          payload: JSON.stringify(result),
          computedAt: new Date(),
        },
      })
    await db.execute(sql`
      delete from "derived_calculation_cache"
      where "cache_key" in (
        select "cache_key"
        from "derived_calculation_cache"
        order by "computed_at" desc
        offset ${MAX_CACHED_CALCULATIONS}
      )
    `)
  }
  return result
}

async function readCacheSnapshot(cacheKey: string) {
  const result = await requireDb().execute<{ sourceRevision: number | string; payload: string | null }>(sql`
    with "ensure_state" as (
      insert into ${derivedCalculationState} ("id", "source_revision", "updated_at")
      values (${DERIVED_CALCULATION_STATE_ID}, 0, now())
      on conflict ("id") do nothing
      returning "source_revision"
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

async function getSourceRevision() {
  return (await readCacheSnapshot('')).sourceRevision
}
