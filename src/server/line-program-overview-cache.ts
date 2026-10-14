import { and, eq, inArray } from 'drizzle-orm'
import { derivedCalculationCache } from '@/db/schema'
import { getLineProgramIdentityKey, type LineProgramRecord } from '@/lib/line-program'
import type { LineProgramOverview } from '@/lib/line-program-overview'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { LINE_PROGRAM_OVERVIEW_CACHE_PREFIX, writeDerivedCalculationCache } from './derived-calculation-cache'

export const LINE_PROGRAM_OVERVIEW_CACHE_READ_BATCH_SIZE = 500
export const MAX_LINE_PROGRAM_OVERVIEW_CACHE_PAYLOAD_BYTES = 256 * 1024
export type LineProgramOverviewCacheLine = Pick<LineProgramRecord, 'id' | 'version' | 'projectTitle' | 'subtitleCode' | 'line'>
export type CachedLineProgramOverview = {
  identityKey: string
  lineId: number
  version: string
  overviewPayload: { overview: LineProgramOverview; searchStamps: string[] }
}

const cacheKey = (lineId: number) => `${LINE_PROGRAM_OVERVIEW_CACHE_PREFIX}${lineId}`
// This module can be traversed by the browser build before server-call pruning.
// Use the standard UTF-8 encoder, not a top-level Node builtin import.
const utf8ByteLength = (value: string) => new TextEncoder().encode(value).byteLength

/** Display cache only. The revision and registry lines must come from this same
 * caller-owned repeatable-read snapshot. No state initialization, writes or
 * touches here; validation/save/report-detail paths must use fresh source facts. */
export async function readLineProgramOverviewCache(
  tx: Pick<SystemDocumentSequenceTransaction, 'select'>,
  sourceRevision: number,
  lines: readonly LineProgramOverviewCacheLine[],
): Promise<Map<number, CachedLineProgramOverview>> {
  const hits = new Map<number, CachedLineProgramOverview>()
  if (!Number.isSafeInteger(sourceRevision) || sourceRevision < 0) return hits
  const unique = [...new Map(lines.map(line => [line.id, line])).values()]
  for (let offset = 0; offset < unique.length; offset += LINE_PROGRAM_OVERVIEW_CACHE_READ_BATCH_SIZE) {
    const batch = unique.slice(offset, offset + LINE_PROGRAM_OVERVIEW_CACHE_READ_BATCH_SIZE)
    const expected = new Map(batch.map(line => [cacheKey(line.id), line]))
    const stored = await tx.select({ cacheKey: derivedCalculationCache.cacheKey, payload: derivedCalculationCache.payload })
      .from(derivedCalculationCache).where(and(eq(derivedCalculationCache.sourceRevision, sourceRevision),
        inArray(derivedCalculationCache.cacheKey, [...expected.keys()])))
    for (const row of stored) {
      const line = expected.get(row.cacheKey)
      if (!line || utf8ByteLength(row.payload) > MAX_LINE_PROGRAM_OVERVIEW_CACHE_PAYLOAD_BYTES) continue
      try {
        const entry: unknown = JSON.parse(row.payload)
        if (!isCachedOverview(entry) || entry.namespace !== LINE_PROGRAM_OVERVIEW_CACHE_PREFIX ||
          entry.lineId !== line.id || entry.version !== line.version || entry.identityKey !== getLineProgramIdentityKey(line)) continue
        const { namespace: _namespace, ...value } = entry
        hits.set(line.id, value)
      } catch { /* Corrupt display cache is a miss; never repair inside the snapshot. */ }
    }
  }
  return hits
}

/** Call only after the read transaction has completed. Late calculations are
 * discarded by the state-row revision lock, never promoted by their writer. */
export async function writeLineProgramOverviewCache(sourceRevision: number, entries: readonly CachedLineProgramOverview[]): Promise<void> {
  await writeDerivedCalculationCache(sourceRevision, entries.flatMap(entry => {
    if (!isCachedOverview(entry)) return []
    const payload = JSON.stringify({
      namespace: LINE_PROGRAM_OVERVIEW_CACHE_PREFIX,
      identityKey: entry.identityKey, lineId: entry.lineId, version: entry.version,
      overviewPayload: entry.overviewPayload,
    })
    // A cache admission limit, not a feature limit: callers keep the full result.
    return utf8ByteLength(payload) > MAX_LINE_PROGRAM_OVERVIEW_CACHE_PAYLOAD_BYTES
      ? [] : [{ cacheKey: cacheKey(entry.lineId), payload }]
  }), 'line-overviews')
}

type CacheEnvelope = CachedLineProgramOverview & { namespace?: string }
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const isCount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0

function isCachedOverview(value: unknown): value is CacheEnvelope {
  if (!isObject(value) || !Number.isSafeInteger(value.lineId) || Number(value.lineId) <= 0 ||
    typeof value.version !== 'string' || !value.version || typeof value.identityKey !== 'string' || !isObject(value.overviewPayload)) return false
  // The explicit envelope identity, not a parsed cache key, drives retention.
  try {
    const parts: unknown = JSON.parse(value.identityKey)
    if (!Array.isArray(parts) || parts.length !== 3 || parts.some(part => typeof part !== 'string') ||
      getLineProgramIdentityKey({ projectTitle: parts[0], subtitleCode: parts[1], line: parts[2] }) !== value.identityKey) return false
  } catch { return false }
  const { overview, searchStamps } = value.overviewPayload
  if (!Array.isArray(searchStamps) || searchStamps.some(stamp => typeof stamp !== 'string') || !isObject(overview)) return false
  if (!['joints', 'calculationJoints', 'stamps', 'additional', 'approved', 'reducible', 'pending', 'rejected'].every(key => isCount(overview[key])) ||
    !['journalRows', 'errors', 'integrityIssues', 'unfinishedChains'].every(key => overview[key] === undefined || isCount(overview[key]))) return false
  return ['common', 'pvk'].every(key => overview[key] === null || isObject(overview[key]) &&
    ['required', 'covered', 'missing', 'actionableRequired', 'excess'].every(field => isCount((overview[key] as Record<string, unknown>)[field])))
}
