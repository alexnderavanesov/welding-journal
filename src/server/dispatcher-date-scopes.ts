import { sql } from 'drizzle-orm'
import { duplicateControls, preHeatTreatmentControls, weldJoints } from '@/db/schema'
import { getBusinessDateIso } from '@/lib/business-date'
import type { DispatcherDirtyScope } from './dispatcher-task-index-dirty'
import { MAX_SCOPED_REBUILD_SCOPES } from './dispatcher-dirty-scope-selection'
import { getDispatcherScopeKey } from './dispatcher-weld-rows'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

/** Row tasks depend on today through future weld dates (including warning
 * text) and open-ended suspensions checked on welding OR rejected-control date.
 * Expiry reminders are always rebuilt separately. All source dates are PG DATE;
 * compare directly, never cast/parse them with different JS date rules. Include
 * future controls conservatively even when the current result/settings don't
 * use them. The caller expands WHOLE contexts
 * and repeats selection under publication locks before using this result.
 */
export async function loadDispatcherDateScopes(
  tx: Pick<SystemDocumentSequenceTransaction, 'execute'>,
  computedAt: Date,
  dirtyScopes: readonly DispatcherDirtyScope[],
  now = new Date(),
): Promise<DispatcherDirtyScope[] | null> {
  if (!Number.isFinite(computedAt.getTime())) return null
  const previousDay = getBusinessDateIso(computedAt), today = getBusinessDateIso(now)
  if (previousDay === today) return [...dirtyScopes]
  const earliestDay = previousDay < today ? previousDay : today
  const result = await tx.execute<DispatcherDirtyScope>(sql`
    with date_sensitive_scopes as (
      select distinct ${weldJoints.projectTitle} as "projectTitle",
        ${weldJoints.subtitleCode} as "subtitleCode", ${weldJoints.line} as "line"
      from ${weldJoints}
      where ${weldJoints.weldDate} > ${earliestDay}::date
        or ${weldJoints.rkConclusionDate} > ${earliestDay}::date
        or ${weldJoints.uzkConclusionDate} > ${earliestDay}::date
        or ${weldJoints.id} in (
          select ${duplicateControls.weldJointId} from ${duplicateControls}
          where ${duplicateControls.conclusionDate} > ${earliestDay}::date
            or ${duplicateControls.controlDate} > ${earliestDay}::date
          union
          select ${preHeatTreatmentControls.weldJointId} from ${preHeatTreatmentControls}
          where ${preHeatTreatmentControls.conclusionDate} > ${earliestDay}::date
        )
      limit ${MAX_SCOPED_REBUILD_SCOPES + 1}
    )
    select * from date_sensitive_scopes
  `)
  if (result.rows.length > MAX_SCOPED_REBUILD_SCOPES) return null
  const scopes = new Map(dirtyScopes.map(scope => [getDispatcherScopeKey(scope), scope]))
  for (const row of result.rows) {
    const scope = { projectTitle: row.projectTitle ?? '', subtitleCode: row.subtitleCode ?? '', line: row.line ?? '' }
    scopes.set(getDispatcherScopeKey(scope), scope)
  }
  return scopes.size <= MAX_SCOPED_REBUILD_SCOPES ? [...scopes.values()] : null
}
