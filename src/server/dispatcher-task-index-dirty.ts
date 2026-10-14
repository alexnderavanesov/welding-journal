import { sql, type SQL } from 'drizzle-orm'
import { requireDb } from '@/db'
import { FULL_REBUILD_GENERATION_KIND } from './dispatcher-refresh-catchup'
import { getLineProgramIdentityKey } from '@/lib/line-program'
import { LINE_PROGRAM_OVERVIEW_CACHE_PREFIX } from './derived-calculation-cache'
import {
  DISPATCHER_INDEX_LOCK_ID,
  DISPATCHER_INDEX_STATE_ID,
} from '@/server/dispatcher-task-index-constants'

const DERIVED_CALCULATION_STATE_ID = 1

type SqlExecutor = {
  execute: (query: SQL) => PromiseLike<unknown>
}

export type DispatcherDirtyScope = {
  projectTitle: string
  subtitleCode: string
  line: string
}

type DispatcherDirtyScopeSource = {
  projectTitle?: unknown
  subtitleCode?: unknown
  line?: unknown
}

export function getDispatcherDirtyScopes(
  records: readonly DispatcherDirtyScopeSource[],
  previousRows: ReadonlyMap<number, DispatcherDirtyScopeSource>,
) {
  const scopes = new Map<string, DispatcherDirtyScope>()
  const addScope = (record: DispatcherDirtyScopeSource) => {
    const scope = {
      projectTitle: String(record.projectTitle ?? '').trim(),
      subtitleCode: String(record.subtitleCode ?? '').trim(),
      line: String(record.line ?? '').trim(),
    }
    scopes.set(JSON.stringify(scope), scope)
  }
  records.forEach(addScope)
  previousRows.forEach(addScope)
  return [...scopes.values()]
}

export async function markDispatcherTaskIndexDirty(
  executor: SqlExecutor = requireDb(),
  options: {
    scopes?: DispatcherDirtyScope[]
    fullRebuild?: boolean
  } = {},
) {
  const scopes = normalizeDirtyScopes(options.scopes ?? [])
  const fullRebuild = options.fullRebuild ?? scopes.length === 0
  const serializedScopes = JSON.stringify(scopes)
  await executor.execute(sql`
    with "dispatcher_lock" as (
      select pg_advisory_xact_lock(${DISPATCHER_INDEX_LOCK_ID}) as "acquired"
    ),
    "dispatcher_state" as (
      insert into "dispatcher_task_index_state"
        ("id", "source_revision", "computed_revision", "repeated_tasks", "welder_stamp_expiry_tasks", "duplicate_keys", "dirty_scopes", "full_rebuild", "updated_at")
      select
        ${DISPATCHER_INDEX_STATE_ID}, 1, -1, '[]', '[]', '[]',
        case when ${fullRebuild} then jsonb_build_array(jsonb_build_object('kind', ${FULL_REBUILD_GENERATION_KIND}::text, 'revision', 1))::text
          else ${serializedScopes} end, ${fullRebuild}, now()
      from "dispatcher_lock"
      on conflict ("id") do update
      set
        "source_revision" = "dispatcher_task_index_state"."source_revision" + 1,
        "dirty_scopes" = case
          when ${fullRebuild} then jsonb_build_array(jsonb_build_object('kind', ${FULL_REBUILD_GENERATION_KIND}::text,
            'revision', "dispatcher_task_index_state"."source_revision" + 1))::text
          else (
            select coalesce(jsonb_agg(distinct scope), '[]'::jsonb)::text
            from jsonb_array_elements(
              coalesce("dispatcher_task_index_state"."dirty_scopes", '[]')::jsonb || ${serializedScopes}::jsonb
            ) scope
          )
        end,
        "full_rebuild" = "dispatcher_task_index_state"."full_rebuild" or ${fullRebuild},
        "updated_at" = now()
      returning "id"
    ),
    "derived_state" as (
      insert into "derived_calculation_state" ("id", "source_revision", "updated_at")
      select ${DERIVED_CALCULATION_STATE_ID}, 1, now()
      from "dispatcher_state"
      on conflict ("id") do update
      set
        "source_revision" = "derived_calculation_state"."source_revision" + 1,
        "updated_at" = now()
      returning "source_revision"
    )
    ${buildDerivedCacheRetention(fullRebuild ? null : scopes.map(getLineProgramIdentityKey))}
  `)
}

export async function invalidateDerivedCalculationCache(
  executor: SqlExecutor = requireDb(),
  options: { preserveLineOverviews?: boolean } = {},
) {
  await executor.execute(sql`
    with "derived_state" as (
      insert into "derived_calculation_state" ("id", "source_revision", "updated_at")
      values (${DERIVED_CALCULATION_STATE_ID}, 1, now())
      on conflict ("id") do update
      set
        "source_revision" = "derived_calculation_state"."source_revision" + 1,
        "updated_at" = now()
      returning "source_revision"
    )
    ${buildDerivedCacheRetention(options.preserveLineOverviews ? [] : null)}
  `)
}

/** The derived_state upsert holds the same row lock as cache publication. Only
 * the immediately preceding revision may advance; pending old calculations and
 * already invalidated payloads must not be resurrected on a subsequent write.
 * null is a full clear, [] is an explicitly independent invalidation. */
function buildDerivedCacheRetention(affectedIdentityKeys: readonly string[] | null) {
  if (affectedIdentityKeys === null) return sql`
    delete from "derived_calculation_cache" where exists (select 1 from "derived_state")
  `
  return sql`, "retained_overviews" as (
    update "derived_calculation_cache" as cache
    set "source_revision" = state."source_revision"
    from "derived_state" as state
    where cache."source_revision" = state."source_revision" - 1
      and cache."cache_key" like ${LINE_PROGRAM_OVERVIEW_CACHE_PREFIX + '%'}
      and case when cache."payload" is json object then
        (cache."payload"::jsonb ->> 'namespace') = ${LINE_PROGRAM_OVERVIEW_CACHE_PREFIX}
        and jsonb_typeof(cache."payload"::jsonb -> 'identityKey') = 'string'
        and not ((cache."payload"::jsonb ->> 'identityKey') = any(${sql.param([...new Set(affectedIdentityKeys)])}::text[]))
      else false end
    returning cache."cache_key"
  )
  delete from "derived_calculation_cache"
  where exists (select 1 from "derived_state")
    and "cache_key" not in (select "cache_key" from "retained_overviews")
  `
}

function normalizeDirtyScopes(scopes: DispatcherDirtyScope[]) {
  const unique = new Map<string, DispatcherDirtyScope>()
  for (const scope of scopes) {
    const normalized = {
      projectTitle: String(scope.projectTitle ?? '').trim(),
      subtitleCode: String(scope.subtitleCode ?? '').trim(),
      line: String(scope.line ?? '').trim(),
    }
    unique.set(JSON.stringify(normalized), normalized)
  }
  return [...unique.values()]
}
