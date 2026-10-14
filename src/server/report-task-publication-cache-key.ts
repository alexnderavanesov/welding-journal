import { sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { dispatcherBackgroundTaskIndexState, dispatcherTaskIndexState } from '@/db/schema'
import { DISPATCHER_TASK_FILTER_KEY, DISPATCHER_TASKS_FIELD_KEY } from '@/lib/dispatcher-task-row-codes'
import { DISPATCHER_BACKGROUND_INDEX_STATE_ID, DISPATCHER_INDEX_STATE_ID } from './dispatcher-task-index-constants'

type ReportTaskPublicationFingerprint = {
  activeComputedRevision: number | null
  activeComputedAt: string | null
  backgroundComputedSourceRevision: number | null
  backgroundComputedAt: string | null
  backgroundStatus: string | null
  backgroundUpdatedAt: string | null
}

export type ReportTaskPublicationCacheIdentity = {
  taskPublication?: ReportTaskPublicationFingerprint
}

/** Extra cache identity only for reads depending on persisted task membership.
 * Read after any required dispatcher freshness barrier and before cache lookup.
 * Never initializes state, schedules a refresh or hydrates task/row payloads.
 */
export async function getReportTaskPublicationCacheIdentity(
  columnFilters: Readonly<Record<string, string>> = {},
  fieldKey?: string,
): Promise<ReportTaskPublicationCacheIdentity> {
  if (fieldKey !== DISPATCHER_TASKS_FIELD_KEY &&
      !String(columnFilters[DISPATCHER_TASKS_FIELD_KEY] ?? '').trim() &&
      !String(columnFilters[DISPATCHER_TASK_FILTER_KEY] ?? '').trim()) return {}

  // One statement gives both singleton states the same database snapshot.
  // Format timestamps in SQL: Date objects collapse in stableSerialize, and
  // JS millisecond conversion would discard PostgreSQL microsecond precision.
  const result = await requireDb().execute<ReportTaskPublicationFingerprint>(sql`
    select
      ${dispatcherTaskIndexState.computedRevision} as "activeComputedRevision",
      to_char(${dispatcherTaskIndexState.computedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "activeComputedAt",
      ${dispatcherBackgroundTaskIndexState.computedSourceRevision} as "backgroundComputedSourceRevision",
      to_char(${dispatcherBackgroundTaskIndexState.computedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "backgroundComputedAt",
      ${dispatcherBackgroundTaskIndexState.status} as "backgroundStatus",
      to_char(${dispatcherBackgroundTaskIndexState.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "backgroundUpdatedAt"
    from (values (1)) as "singleton"("id")
    left join ${dispatcherTaskIndexState}
      on ${dispatcherTaskIndexState.id} = ${DISPATCHER_INDEX_STATE_ID}
    left join ${dispatcherBackgroundTaskIndexState}
      on ${dispatcherBackgroundTaskIndexState.id} = ${DISPATCHER_BACKGROUND_INDEX_STATE_ID}
  `)
  const fingerprint = result.rows[0]
  // Missing state rows yield null columns through the left joins, not zero rows.
  if (!fingerprint) throw new Error('Не удалось прочитать версии публикации задач отчёта.')
  return { taskPublication: fingerprint }
}
