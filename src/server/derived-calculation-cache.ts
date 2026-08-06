import { and, eq, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  derivedCalculationCache,
  derivedCalculationState,
} from '@/db/schema'

const DERIVED_CALCULATION_STATE_ID = 1
const MAX_CACHED_CALCULATIONS = 96
const inFlightCalculations = new Map<string, Promise<unknown>>()

export async function getOrComputeDerivedCalculation<T>(
  cacheKey: string,
  compute: () => Promise<T>,
): Promise<T> {
  const sourceRevision = await getSourceRevision()
  const inFlightKey = `${sourceRevision}:${cacheKey}`
  const existing = inFlightCalculations.get(inFlightKey)
  if (existing) return existing as Promise<T>

  const calculation = readOrCompute(cacheKey, sourceRevision, compute)
  inFlightCalculations.set(inFlightKey, calculation)
  try {
    return await calculation
  } finally {
    if (inFlightCalculations.get(inFlightKey) === calculation) {
      inFlightCalculations.delete(inFlightKey)
    }
  }
}

export function buildDerivedCalculationCacheKey(namespace: string, input: unknown) {
  return `${namespace}:${stableSerialize(input)}`
}

async function readOrCompute<T>(
  cacheKey: string,
  sourceRevision: number,
  compute: () => Promise<T>,
): Promise<T> {
  const db = requireDb()
  const cached = await db
    .select({ payload: derivedCalculationCache.payload })
    .from(derivedCalculationCache)
    .where(
      and(
        eq(derivedCalculationCache.cacheKey, cacheKey),
        eq(derivedCalculationCache.sourceRevision, sourceRevision),
      ),
    )
    .limit(1)

  if (cached[0]) {
    try {
      return JSON.parse(cached[0].payload) as T
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

async function getSourceRevision() {
  const db = requireDb()
  await db
    .insert(derivedCalculationState)
    .values({
      id: DERIVED_CALCULATION_STATE_ID,
      sourceRevision: 0,
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
  const rows = await db
    .select({ sourceRevision: derivedCalculationState.sourceRevision })
    .from(derivedCalculationState)
    .where(eq(derivedCalculationState.id, DERIVED_CALCULATION_STATE_ID))
    .limit(1)
  return rows[0]?.sourceRevision ?? 0
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? String(value)
}
