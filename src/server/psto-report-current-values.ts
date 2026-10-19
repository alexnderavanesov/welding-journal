import { or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

import { duplicateControls, pstoRepeatCycles, weldJoints } from '@/db/schema'
import { CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES } from '@/lib/control-availability-values'
import { LNK_METHODS } from '@/lib/report-config'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { buildNullableControlEnabledWhere } from './control-availability-sql'
import { reportResultSql, reportTextSql as textValue } from './report-filter-text-sql'
import { buildNoRejectedPreHeatTreatmentWhere } from './pre-heat-treatment-policy'

const CYCLE_FIELD_KEYS = [
  'pstoRequest', 'pstoRequestDate', 'pstoDate', 'heatTreatmentDiagram', 'pstoResult', 'pstoNote',
  'tvmtRequest', 'tvmtRequestDate', 'tvmtResult', 'tvmtConclusionDate', 'tvmtConclusion',
] as const satisfies readonly WeldFieldKey[]

export const PSTO_CURRENT_SQL_FIELD_KEYS = new Set<WeldFieldKey>([
  ...CYCLE_FIELD_KEYS, 'pstoControlBasis', 'pstoCancellationDate',
])
type CycleSqlFields = Pick<typeof weldJoints,
  'pstoDate' | 'heatTreatmentDiagram' | 'pstoResult' | 'tvmtRequest' |
  'tvmtRequestDate' | 'tvmtResult' | 'tvmtConclusionDate' | 'tvmtConclusion'>

const isActive = () => buildNullableControlEnabledWhere(weldJoints.pstoRequired, CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES)
const isCancelled = () => sql`lower(${textValue(weldJoints.pstoRequired)}) = 'отменен'`

/** Exact counterpart of hasPstoCycleExecutionHistory. A request for PSTO and a
 * waiting/unknown TVMT label alone are not evidence of performed treatment. */
function cycleExecutionWhere(cycle: { [Key in keyof CycleSqlFields]: SQLWrapper }) {
  return sql<boolean>`(
    ${textValue(cycle.pstoDate)} <> ''
    or ${textValue(cycle.heatTreatmentDiagram)} <> ''
    or ${reportResultSql(cycle.pstoResult)} in ('проведено', 'проведено (отменен)', 'да')
    or ${textValue(cycle.tvmtRequest)} <> ''
    or ${textValue(cycle.tvmtRequestDate)} <> ''
    or ${reportResultSql(cycle.tvmtResult)} in ('годен', 'да', 'не годен', 'негоден', 'ремонт', 'вырез')
    or ${textValue(cycle.tvmtConclusionDate)} <> ''
    or ${textValue(cycle.tvmtConclusion)} <> ''
  )`
}

/** One definition of current-cycle identity for values and the cycle summary. */
export function buildPstoCurrentCycleQuery(primaryColumns: SQL, repeatColumns: SQL) {
  return sql`select * from (
    select ${primaryColumns}, 1 as "sequence", 0 as "id", ${cycleExecutionWhere(weldJoints)} as "performed"
    union all
    select ${repeatColumns}, ${pstoRepeatCycles.sequence}, ${pstoRepeatCycles.id}, ${cycleExecutionWhere(pstoRepeatCycles)}
    from ${pstoRepeatCycles}
    where ${pstoRepeatCycles.weldJointId} = ${weldJoints.id} and ${pstoRepeatCycles.sequence} >= 2
  ) as "psto_display_cycles"
  order by case when ${isActive()} then false else "psto_display_cycles"."performed" end desc,
    "psto_display_cycles"."sequence" desc, "psto_display_cycles"."id" desc limit 1`
}

export function buildReportHasRejectedLnkSql() {
  return or(
    ...LNK_METHODS.map(method => sql`${reportResultSql(weldJoints[method.resultKey])} in ('ремонт', 'вырез')`),
    sql`exists (select 1 from ${duplicateControls} where ${duplicateControls.weldJointId} = ${weldJoints.id}
      and ${duplicateControls.result} in ('ремонт', 'вырез'))`,
    sql`not (${buildNoRejectedPreHeatTreatmentWhere({ autoVikForWeldDate: true })})`,
  )!
}

/** Correlated by the existing (weld_joint_id, sequence) index. It selects one
 * current cycle before reading its value; a sparse repeat must stay empty. */
export function buildPstoCurrentReportValueSql(fieldKey: WeldFieldKey): SQL<string> | undefined {
  if (!PSTO_CURRENT_SQL_FIELD_KEYS.has(fieldKey)) return undefined
  if (fieldKey === 'pstoControlBasis' || fieldKey === 'pstoCancellationDate') {
    return sql<string>`case when ${isCancelled()} then ${textValue(weldJoints[fieldKey])} else '' end`
  }
  const cycleKey = fieldKey as (typeof CYCLE_FIELD_KEYS)[number]
  // Mirrors withPendingPstoResultStatus in the table preparation pipeline.
  // Apply this only to the primary value, never after selecting a repeat.
  const primaryValue = fieldKey === 'pstoResult' ? sql<string>`case
    when ${isActive()} and (${textValue(weldJoints.pstoResult)} = ''
      or ${reportResultSql(weldJoints.pstoResult)} in ('ожидает', 'ожидает заявку'))
    then case when ${textValue(weldJoints.pstoRequest)} <> '' then 'ожидает' else 'ожидает заявку' end
    else ${textValue(weldJoints.pstoResult)} end` : textValue(weldJoints[cycleKey])
  const currentValue = sql<string>`(select "psto_current_value"."value" from (${buildPstoCurrentCycleQuery(
    sql`${primaryValue} as "value"`, sql`${textValue(pstoRepeatCycles[cycleKey])} as "value"`,
  )}) as "psto_current_value")`
  if (fieldKey !== 'pstoResult') return currentValue

  const value = sql`"psto_display_current"."value"`
  const normalizedResult = reportResultSql(value)
  const hasRejectedLnk = buildReportHasRejectedLnkSql()
  return sql<string>`(select case
    when ${isCancelled()} then case
      when ${normalizedResult} in ('проведено', 'да', 'проведено (отменен)') then 'проведено · назначение отменено'
      else 'отменен' end
    when ${isActive()} and ${hasRejectedLnk}
      and ${normalizedResult} not in ('проведено', 'проведено (отменен)', 'отменен') then 'нет потребности'
    else ${value} end
    from (select ${currentValue} as "value") as "psto_display_current")`
}
