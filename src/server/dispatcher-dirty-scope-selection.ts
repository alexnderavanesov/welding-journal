import { and, or, sql } from 'drizzle-orm'
import { dispatcherAcceptedWarnings, linePrograms, welderStamps, weldJoints } from '@/db/schema'
import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from '@/lib/report-common-config'
import { normalizeStampForCompare } from '@/lib/welder-stamp-compatibility-utils'
import type { DispatcherDirtyScope } from './dispatcher-task-index-dirty'
import { getDispatcherScopeKey } from './dispatcher-weld-rows'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { FULL_REBUILD_GENERATION_KIND } from './dispatcher-refresh-catchup'
import { DISPATCHER_SCOPE_WHITESPACE as WHITESPACE } from '@/lib/dispatcher-scope-normalization'

export const MAX_SCOPED_REBUILD_SCOPES = 500
export const MAX_SCOPED_REBUILD_ROWS = 5_000
const SCOPE_FIELDS = ['projectTitle', 'subtitleCode', 'line'] as const

/** Shared by conservative dependency selection and bounded qualification profiles.
 * null means SQL/JS alias normalization cannot safely be treated as equivalent.
 */
export function buildWelderStampAliasWhere(officialAliases: readonly string[]) {
  const aliases = [...new Set(officialAliases.map(normalizeStampForCompare).filter(Boolean))]
  if (aliases.some(alias => /[^\x00-\x7f]/.test(alias))) return null
  return aliases.length ? or(...OFFICIAL_WELDER_STAMP_FIELD_KEYS.map(key =>
    sql`upper(btrim(coalesce(${weldJoints[key]}, ''), ${WHITESPACE})) = any(${sql.param(aliases)}::text[])`,
  ))! : sql`false`
}

/** null means unsafe/full, never an empty (reminder-only) invalidation. */
export function parseDispatcherDirtyScopes(value: unknown, allowFullRebuildGeneration = false): DispatcherDirtyScope[] | null {
  if (typeof value !== 'string') return null
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return null }
  if (!Array.isArray(parsed)) return null
  const scopes: DispatcherDirtyScope[] = []
  let generationSeen = false
  for (const item of parsed) {
    if (allowFullRebuildGeneration && item?.kind === FULL_REBUILD_GENERATION_KIND) {
      if (generationSeen || Object.keys(item).length !== 2 || !Number.isSafeInteger(item.revision) || item.revision < 1) return null
      generationSeen = true
      continue
    }
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
      Object.keys(item).length !== SCOPE_FIELDS.length ||
      !SCOPE_FIELDS.every(key => typeof item[key] === 'string')) return null
    scopes.push({ projectTitle: item.projectTitle, subtitleCode: item.subtitleCode, line: item.line })
  }
  return scopes
}

/** Caller holds the exclusive registry lock. Freeze FK owners before reading
 * decisions so a concurrent acceptance cannot escape a delete/rename cascade.
 * All aliases and decision lines are selected together, never one query per stamp.
 */
export async function loadWelderStampDispatcherScopes(
  tx: Pick<SystemDocumentSequenceTransaction, 'execute'>,
  officialAliases: readonly string[], decisionOwnerIds: readonly number[],
): Promise<DispatcherDirtyScope[] | null> {
  const aliases = [...new Set(officialAliases.map(normalizeStampForCompare).filter(Boolean))]
  if (!aliases.length && !decisionOwnerIds.length) return []
  const aliasWhere = buildWelderStampAliasWhere(aliases)
  if (aliasWhere === null) return null
  if (decisionOwnerIds.length) await tx.execute(sql`
    select ${welderStamps.id} from ${welderStamps}
    where ${welderStamps.id} = any(${sql.param(decisionOwnerIds)}::integer[])
    order by ${welderStamps.id} for update
  `)
  const ownerWhere = sql`${dispatcherAcceptedWarnings.welderStampId} = any(${sql.param(decisionOwnerIds)}::integer[])`
  const result = await tx.execute<DispatcherDirtyScope & { unsafe: boolean }>(sql`
    with affected_scopes as (
      select ${weldJoints.projectTitle} as "projectTitle", ${weldJoints.subtitleCode} as "subtitleCode", ${weldJoints.line} as "line"
      from ${weldJoints} where ${aliasWhere}
      union
      select ${linePrograms.projectTitle}, ${linePrograms.subtitleCode}, ${linePrograms.line}
      from ${dispatcherAcceptedWarnings} inner join ${linePrograms} on ${linePrograms.id} = ${dispatcherAcceptedWarnings.lineProgramId}
      where ${ownerWhere}
      union
      select ${weldJoints.projectTitle}, ${weldJoints.subtitleCode}, ${weldJoints.line}
      from ${dispatcherAcceptedWarnings} inner join ${weldJoints} on ${weldJoints.id} = ${dispatcherAcceptedWarnings.weldJointId}
      where ${ownerWhere}
    ), bounded_scopes as (select * from affected_scopes limit ${MAX_SCOPED_REBUILD_SCOPES + 1})
    select *, false as "unsafe" from bounded_scopes
    union all
    select null, null, null, true where exists (
      select 1 from ${dispatcherAcceptedWarnings} where ${ownerWhere}
        and ${dispatcherAcceptedWarnings.kind} <> 'welder-stamp-expiry'
        and ${dispatcherAcceptedWarnings.lineProgramId} is null and ${dispatcherAcceptedWarnings.weldJointId} is null
    )
  `)
  if (result.rows.some(row => row.unsafe) || result.rows.length > MAX_SCOPED_REBUILD_SCOPES) return null
  return result.rows.map(row => ({ projectTitle: row.projectTitle ?? '', subtitleCode: row.subtitleCode ?? '', line: row.line ?? '' }))
}

/** Expand to the complete status/chain context and count ALL its rows, not only
 * matching stamps. Run again under publication locks: queued writes can widen it.
 */
export async function loadBoundedDispatcherDirtyScopes(
  tx: Pick<SystemDocumentSequenceTransaction, 'select'>, scopes: readonly DispatcherDirtyScope[],
): Promise<DispatcherDirtyScope[] | null> {
  if (!scopes.length) return []
  if (scopes.length > MAX_SCOPED_REBUILD_SCOPES) return null
  const where = or(...scopes.map(scope => and(...SCOPE_FIELDS.map(key =>
    sql`lower(translate(coalesce(${weldJoints[key]}, ''), ${WHITESPACE}, '')) = ${scope[key].replace(/\s+/g, '').toLocaleLowerCase('ru-RU')}`,
  ))))!
  const current = await tx.select({ projectTitle: weldJoints.projectTitle, subtitleCode: weldJoints.subtitleCode,
    line: weldJoints.line, joints: sql<number>`count(*)::int`,
  }).from(weldJoints).where(where).groupBy(weldJoints.projectTitle, weldJoints.subtitleCode, weldJoints.line)
    .limit(MAX_SCOPED_REBUILD_SCOPES + 1)
  if (current.length > MAX_SCOPED_REBUILD_SCOPES || current.reduce((sum, scope) => sum + Number(scope.joints), 0) > MAX_SCOPED_REBUILD_ROWS) return null
  // The scoped loader uses btrim (ASCII space); do not publish a partial legacy
  // context containing tabs/NBSP at the edges. Full hydration uses exact IDs.
  if ([...scopes, ...current].some(scope => SCOPE_FIELDS.some(key => {
    const value = scope[key] ?? ''
    return value.replace(/^ +| +$/g, '') !== value.trim()
  }))) return null
  const unique = new Map(scopes.map(scope => [getDispatcherScopeKey(scope), scope]))
  for (const scope of current) {
    const value = { projectTitle: scope.projectTitle ?? '', subtitleCode: scope.subtitleCode ?? '', line: scope.line ?? '' }
    unique.set(getDispatcherScopeKey(value), value)
  }
  return unique.size <= MAX_SCOPED_REBUILD_SCOPES ? [...unique.values()] : null
}
