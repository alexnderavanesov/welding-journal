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

export async function markDispatcherTaskIndexDirty(executor: SqlExecutor = requireDb()) {
  await executor.execute(sql`select pg_advisory_xact_lock(${DISPATCHER_INDEX_LOCK_ID})`)
  await executor.execute(sql`
    insert into "dispatcher_task_index_state"
      ("id", "source_revision", "computed_revision", "repeated_tasks", "welder_stamp_expiry_tasks", "duplicate_keys", "updated_at")
    values
      (${DISPATCHER_INDEX_STATE_ID}, 1, -1, '[]', '[]', '[]', now())
    on conflict ("id") do update
    set
      "source_revision" = "dispatcher_task_index_state"."source_revision" + 1,
      "updated_at" = now()
  `)
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
