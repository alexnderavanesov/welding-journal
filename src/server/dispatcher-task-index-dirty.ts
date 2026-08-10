import { sql, type SQL } from 'drizzle-orm'
import { requireDb } from '@/db'
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
  await executor.execute(sql`select pg_advisory_xact_lock(${DISPATCHER_INDEX_LOCK_ID})`)
  await executor.execute(sql`
    insert into "dispatcher_task_index_state"
      ("id", "source_revision", "computed_revision", "repeated_tasks", "welder_stamp_expiry_tasks", "duplicate_keys", "dirty_scopes", "full_rebuild", "updated_at")
    values
      (${DISPATCHER_INDEX_STATE_ID}, 1, -1, '[]', '[]', '[]', ${serializedScopes}, ${fullRebuild}, now())
    on conflict ("id") do update
    set
      "source_revision" = "dispatcher_task_index_state"."source_revision" + 1,
      "dirty_scopes" = case
        when "dispatcher_task_index_state"."full_rebuild" or ${fullRebuild} then '[]'
        else (
          select coalesce(jsonb_agg(distinct scope), '[]'::jsonb)::text
          from jsonb_array_elements(
            coalesce("dispatcher_task_index_state"."dirty_scopes", '[]')::jsonb || ${serializedScopes}::jsonb
          ) scope
        )
      end,
      "full_rebuild" = "dispatcher_task_index_state"."full_rebuild" or ${fullRebuild},
      "updated_at" = now()
  `)
  await invalidateDerivedCalculationCache(executor)
}

export async function invalidateDerivedCalculationCache(
  executor: SqlExecutor = requireDb(),
) {
  await executor.execute(sql`
    insert into "derived_calculation_state" ("id", "source_revision", "updated_at")
    values (${DERIVED_CALCULATION_STATE_ID}, 1, now())
    on conflict ("id") do update
    set
      "source_revision" = "derived_calculation_state"."source_revision" + 1,
      "updated_at" = now()
  `)
  await executor.execute(sql`delete from "derived_calculation_cache"`)
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
