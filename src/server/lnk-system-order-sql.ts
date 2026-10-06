import { and, or, sql, type SQLWrapper } from 'drizzle-orm'
import { weldJoints } from '@/db/schema'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES } from '@/lib/control-availability-values'
import { buildNormalizedControlAvailabilityWhere } from './control-availability-sql'

/** Mirrors normalizeResultStatus's text cleanup; cancellation preserves facts. */
export function buildNormalizedLnkResultText(column: SQLWrapper) {
  return sql`regexp_replace(lower(btrim(coalesce(${column}::text, ''))), ' · назначение отменено$', '')`
}

/** SQL counterpart of canBackfillOwnLnkResult. This selects historical-entry
 * candidates, never a new waiting debt. Actual dates are checked when saving. */
export function buildOwnLnkBackfillWhere(method: (typeof LNK_METHODS)[number]) {
  const level = (code: string) => code === 'ВИК' ? 0 : code === 'ПВК' ? 1 : 2
  const good = (column: SQLWrapper) => sql`${buildNormalizedLnkResultText(column)} in ('годен', 'да', 'проведено', 'годен (отменен)', 'проведено (отменен)')`
  const rejected = (column: SQLWrapper) => sql`${buildNormalizedLnkResultText(column)} in ('ремонт', 'вырез')`
  return and(
    or(...LNK_METHODS.filter(candidate => candidate.code !== method.code && level(candidate.code) >= level(method.code))
      .map(candidate => rejected(weldJoints[candidate.resultKey]))),
    method.code === 'ВИК' ? undefined : good(weldJoints.vikResult),
    level(method.code) === 2 ? or(
      and(sql`not (${buildNormalizedControlAvailabilityWhere(weldJoints.hasPvk, CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES)})`, sql`not (${rejected(weldJoints.pvkResult)})`),
      good(weldJoints.pvkResult),
    ) : undefined,
  ) ?? sql`false`
}
