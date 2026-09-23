import { and, or, sql } from 'drizzle-orm'

import { appSettings, preHeatTreatmentControls, pstoRepeatCycles, weldJoints } from '@/db/schema'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES } from '@/lib/control-availability-values'
import { PRE_HEAT_TREATMENT_LNK_METHODS } from '@/lib/lnk-control-stage'
import { buildNullableControlEnabledWhere } from '@/server/control-availability-sql'

/** Uncorrelated setting lookup: PostgreSQL evaluates it once, not once per weld. */
export function buildPreHeatTreatmentEnabledWhere() {
  return sql<boolean>`coalesce((
    select case when ${appSettings.value} is json
      then (${appSettings.value}::jsonb -> 'preHeatTreatmentLnkEnabled') is distinct from 'false'::jsonb
      else true end
    from ${appSettings} where ${appSettings.key} = ${PROJECT_SETTING_KEYS.controlProcesses}
  ), true)`
}

/** SQL counterpart of hasOwnPstoStart; no line-wide inheritance or waiting labels. */
export function buildOwnPstoStartWhere() {
  const cycleStarted = (cycle: typeof weldJoints | typeof pstoRepeatCycles) => sql`(
    nullif(btrim(coalesce(${cycle.pstoRequest}, '')), '') is not null
    or ${cycle.pstoRequestDate} is not null
    or ${buildCycleExecutionWhere(cycle)}
  )`
  return sql`(${cycleStarted(weldJoints)} or exists (
    select 1 from ${pstoRepeatCycles}
    where ${pstoRepeatCycles.weldJointId} = ${weldJoints.id} and ${cycleStarted(pstoRepeatCycles)}
  ))`
}

function buildCycleExecutionWhere(cycle: typeof weldJoints | typeof pstoRepeatCycles) {
  return sql`(${cycle.pstoDate} is not null
    or nullif(btrim(coalesce(${cycle.heatTreatmentDiagram}, '')), '') is not null
    or lower(btrim(coalesce(${cycle.pstoResult}, ''))) in ('проведено', 'проведено (отменен)', 'да')
    or nullif(btrim(coalesce(${cycle.tvmtRequest}, '')), '') is not null
    or ${cycle.tvmtRequestDate} is not null
    or (nullif(btrim(coalesce(${cycle.tvmtResult}, '')), '') is not null
      and lower(btrim(${cycle.tvmtResult})) not like 'ожидает%')
    or ${cycle.tvmtConclusionDate} is not null
    or nullif(btrim(coalesce(${cycle.tvmtConclusion}, '')), '') is not null
  )`
}

export function buildPstoExecutionHistoryWhere() {
  return sql`(${buildCycleExecutionWhere(weldJoints)} or exists (
    select 1 from ${pstoRepeatCycles}
    where ${pstoRepeatCycles.weldJointId} = ${weldJoints.id} and ${buildCycleExecutionWhere(pstoRepeatCycles)}
  ))`
}

export function buildPreHeatTreatmentAvailableWhere() {
  return and(buildPreHeatTreatmentEnabledWhere(), or(
    buildNullableControlEnabledWhere(weldJoints.pstoRequired, CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES),
    buildPstoExecutionHistoryWhere(),
  )) ?? sql`false`
}

export function buildNoRejectedPreHeatTreatmentWhere() {
  const activeMethod = or(...PRE_HEAT_TREATMENT_LNK_METHODS.map((method) => and(
    sql`${preHeatTreatmentControls.method} = ${method.code}`,
    buildNullableControlEnabledWhere(weldJoints[method.enabledKey], CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES),
  ))) ?? sql`false`
  return sql`(not (${buildPreHeatTreatmentAvailableWhere()}) or not exists (
    select 1 from ${preHeatTreatmentControls}
    where ${preHeatTreatmentControls.weldJointId} = ${weldJoints.id} and ${activeMethod}
      and lower(btrim(coalesce(${preHeatTreatmentControls.result}, ''))) in ('ремонт', 'вырез')
  ))`
}

export function buildHistoricalPreHeatTreatmentExemptionWhere() {
  return sql`(${weldJoints.preHeatTreatmentLnkExempt} and ${buildOwnPstoStartWhere()})`
}

export function buildPreHeatTreatmentRequirementsSkippedWhere() {
  return sql`(not (${buildPreHeatTreatmentEnabledWhere()}) or ${buildHistoricalPreHeatTreatmentExemptionWhere()})`
}
