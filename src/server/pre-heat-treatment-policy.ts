import { and, or, sql, type SQLWrapper } from 'drizzle-orm'

import { preHeatTreatmentControls, pstoRepeatCycles, weldJoints } from '@/db/schema'
import { CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES } from '@/lib/control-availability-values'
import { PRE_HEAT_TREATMENT_LNK_METHODS } from '@/lib/lnk-control-stage'
import { buildNullableControlEnabledWhere } from '@/server/control-availability-sql'

/** The flag is authoritative; legacy full-mode requirements are migrated explicitly. */
export function buildPreHeatTreatmentEnabledWhere() {
  return sql<boolean>`${weldJoints.preHeatTreatmentRequired} is true`
}

type CycleSqlFields = Record<'pstoDate' | 'heatTreatmentDiagram' | 'pstoResult' |
  'tvmtResult' | 'tvmtConclusionDate' | 'tvmtConclusion', SQLWrapper>

function buildCycleExecutionWhere(cycle: CycleSqlFields) {
  return sql`(${cycle.pstoDate} is not null
    or nullif(btrim(coalesce(${cycle.heatTreatmentDiagram}, '')), '') is not null
    or lower(btrim(coalesce(${cycle.pstoResult}, ''))) in ('проведено', 'проведено (отменен)', 'да')
    or (nullif(btrim(coalesce(${cycle.tvmtResult}, '')), '') is not null
      and lower(btrim(${cycle.tvmtResult})) not like 'ожидает%')
    or ${cycle.tvmtConclusionDate} is not null
    or nullif(btrim(coalesce(${cycle.tvmtConclusion}, '')), '') is not null
  )`
}

/** Inactive lines retain unperformed repeats as history, not as the current cycle. */
export function buildRelevantPstoRepeatWhere(cycle: CycleSqlFields) {
  return or(
    buildNullableControlEnabledWhere(weldJoints.pstoRequired, CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES),
    buildCycleExecutionWhere(cycle),
  ) ?? sql`false`
}

export function buildPstoExecutionHistoryWhere() {
  return sql`(${buildCycleExecutionWhere(weldJoints)} or exists (
    select 1 from ${pstoRepeatCycles}
    where ${pstoRepeatCycles.weldJointId} = ${weldJoints.id} and ${buildCycleExecutionWhere(pstoRepeatCycles)}
  ))`
}

export function buildPreHeatTreatmentAvailableWhere() {
  return and(buildPreHeatTreatmentEnabledWhere(),
    buildNullableControlEnabledWhere(weldJoints.pstoRequired, CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES),
  ) ?? sql`false`
}

export function buildPstoDocumentHistoryWhere() {
  return sql`(${buildPstoExecutionHistoryWhere()}
    or nullif(btrim(coalesce(${weldJoints.pstoRequest}, '')), '') is not null
    or ${weldJoints.pstoRequestDate} is not null
    or nullif(btrim(coalesce(${weldJoints.tvmtRequest}, '')), '') is not null
    or ${weldJoints.tvmtRequestDate} is not null
    or exists (select 1 from ${pstoRepeatCycles}
      where ${pstoRepeatCycles.weldJointId} = ${weldJoints.id}
        and (nullif(btrim(coalesce(${pstoRepeatCycles.pstoRequest}, '')), '') is not null
          or ${pstoRepeatCycles.pstoRequestDate} is not null
          or nullif(btrim(coalesce(${pstoRepeatCycles.tvmtRequest}, '')), '') is not null
          or ${pstoRepeatCycles.tvmtRequestDate} is not null)))`
}

export function buildNoRejectedPreHeatTreatmentWhere({ autoVikForWeldDate = false }: { autoVikForWeldDate?: boolean } = {}) {
  const activeMethod = or(...PRE_HEAT_TREATMENT_LNK_METHODS.map((method) => and(
    sql`${preHeatTreatmentControls.method} = ${method.code}`,
    or(
      buildNullableControlEnabledWhere(weldJoints[method.enabledKey], [...CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES, 'отменен']),
      // Report preparation enables VIK for every welded legacy row. Other
      // callers keep their established stored-assignment policy by default.
      autoVikForWeldDate && method.code === 'ВИК' ? sql`${weldJoints.weldDate} is not null` : undefined,
    ),
  ))) ?? sql`false`
  return sql`(not exists (
    select 1 from ${preHeatTreatmentControls}
    where ${preHeatTreatmentControls.weldJointId} = ${weldJoints.id} and ${activeMethod}
      and lower(btrim(coalesce(${preHeatTreatmentControls.result}, ''))) in ('ремонт', 'вырез')
  ))`
}
