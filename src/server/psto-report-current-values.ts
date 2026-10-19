import { or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

import { duplicateControls, pstoRepeatCycles, weldJoints } from '@/db/schema'
import { CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES } from '@/lib/control-availability-values'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getPstoDisplayValue } from '@/lib/lnk-status'
import { withPendingPstoResultStatus } from '@/lib/psto-field-updates'
import { withAutoVikForWeldDate } from '@/lib/weld-record-transforms'
import { LNK_METHODS } from '@/lib/report-config'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { buildNullableControlEnabledWhere } from './control-availability-sql'
import { buildNormalizedLnkResultText } from './lnk-system-order-sql'
import { buildNoRejectedPreHeatTreatmentWhere } from './pre-heat-treatment-policy'

const CYCLE_FIELD_KEYS = [
  'pstoRequest', 'pstoRequestDate', 'pstoDate', 'heatTreatmentDiagram', 'pstoResult', 'pstoNote',
  'tvmtRequest', 'tvmtRequestDate', 'tvmtResult', 'tvmtConclusionDate', 'tvmtConclusion',
] as const satisfies readonly WeldFieldKey[]

export const PSTO_CURRENT_SQL_FIELD_KEYS = new Set<WeldFieldKey>([
  ...CYCLE_FIELD_KEYS, 'pstoControlBasis', 'pstoCancellationDate',
])
const DISPLAY_FIELD_KEYS = new Set<WeldFieldKey>([
  ...PSTO_CURRENT_SQL_FIELD_KEYS, 'pstoCycleSummary', 'controlBasisSummary',
])

/** Temporary filter/facet values only. Never hydrate report cards with this
 * projection: their primary fields are the source of cycle history and exports. */
export function projectPstoReportDisplayValues<Row extends WeldRow>(rows: Row[], fieldKeys: readonly string[]): Row[] {
  const keys = [...new Set(fieldKeys)].filter((key): key is WeldFieldKey => DISPLAY_FIELD_KEYS.has(key as WeldFieldKey))
  if (keys.length === 0) return rows
  return rows.map(row => {
    // The table prepares primary waiting labels before selecting the current
    // cycle. Repeat fields remain factual, including a sparse current repeat.
    const displayRow = { ...withPendingPstoResultStatus(withAutoVikForWeldDate(row)), finalStatus: undefined }
    // The UI recalculates finalStatus; a stored rejection is not a source fact.
    // getPstoDisplayValue already checks the actual main/duplicate/pre-TO
    // rejects, which cover every recalculated rejected final status.
    return {
      ...row,
      ...Object.fromEntries(keys.map(key => [key, getPstoDisplayValue(displayRow, key)])),
    }
  })
}

type CycleSqlFields = Pick<typeof weldJoints,
  'pstoDate' | 'heatTreatmentDiagram' | 'pstoResult' | 'tvmtRequest' |
  'tvmtRequestDate' | 'tvmtResult' | 'tvmtConclusionDate' | 'tvmtConclusion'>

const textValue = (column: SQLWrapper) => sql<string>`btrim(coalesce(${column}::text, ''))`
const isActive = () => buildNullableControlEnabledWhere(weldJoints.pstoRequired, CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES)
const isCancelled = () => sql`lower(${textValue(weldJoints.pstoRequired)}) = 'отменен'`

/** Exact counterpart of hasPstoCycleExecutionHistory. A request for PSTO and a
 * waiting/unknown TVMT label alone are not evidence of performed treatment. */
function cycleExecutionWhere(cycle: { [Key in keyof CycleSqlFields]: SQLWrapper }) {
  return sql<boolean>`(
    ${textValue(cycle.pstoDate)} <> ''
    or ${textValue(cycle.heatTreatmentDiagram)} <> ''
    or ${buildNormalizedLnkResultText(cycle.pstoResult)} in ('проведено', 'проведено (отменен)', 'да')
    or ${textValue(cycle.tvmtRequest)} <> ''
    or ${textValue(cycle.tvmtRequestDate)} <> ''
    or ${buildNormalizedLnkResultText(cycle.tvmtResult)} in ('годен', 'да', 'не годен', 'негоден', 'ремонт', 'вырез')
    or ${textValue(cycle.tvmtConclusionDate)} <> ''
    or ${textValue(cycle.tvmtConclusion)} <> ''
  )`
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
      or ${buildNormalizedLnkResultText(weldJoints.pstoResult)} in ('ожидает', 'ожидает заявку'))
    then case when ${textValue(weldJoints.pstoRequest)} <> '' then 'ожидает' else 'ожидает заявку' end
    else ${textValue(weldJoints.pstoResult)} end` : textValue(weldJoints[cycleKey])
  const currentValue = sql<string>`(
    select "psto_display_cycles"."value"
    from (
      select ${primaryValue} as "value", 1 as "sequence", 0 as "id",
        ${cycleExecutionWhere(weldJoints)} as "performed"
      union all
      select ${textValue(pstoRepeatCycles[cycleKey])}, ${pstoRepeatCycles.sequence}, ${pstoRepeatCycles.id},
        ${cycleExecutionWhere(pstoRepeatCycles)}
      from ${pstoRepeatCycles}
      where ${pstoRepeatCycles.weldJointId} = ${weldJoints.id} and ${pstoRepeatCycles.sequence} >= 2
    ) as "psto_display_cycles"
    order by case when ${isActive()} then false else "psto_display_cycles"."performed" end desc,
      "psto_display_cycles"."sequence" desc, "psto_display_cycles"."id" desc
    limit 1
  )`
  if (fieldKey !== 'pstoResult') return currentValue

  const value = sql`"psto_display_current"."value"`
  const normalizedResult = buildNormalizedLnkResultText(value)
  const hasRejectedLnk = or(
    ...LNK_METHODS.map(method => sql`${buildNormalizedLnkResultText(weldJoints[method.resultKey])} in ('ремонт', 'вырез')`),
    sql`exists (select 1 from ${duplicateControls} where ${duplicateControls.weldJointId} = ${weldJoints.id}
      and ${duplicateControls.result} in ('ремонт', 'вырез'))`,
    sql`not (${buildNoRejectedPreHeatTreatmentWhere({ autoVikForWeldDate: true })})`,
  )!
  return sql<string>`(select case
    when ${isCancelled()} then case
      when ${normalizedResult} in ('проведено', 'да', 'проведено (отменен)') then 'проведено · назначение отменено'
      else 'отменен' end
    when ${isActive()} and ${hasRejectedLnk}
      and ${normalizedResult} not in ('проведено', 'проведено (отменен)', 'отменен') then 'нет потребности'
    else ${value} end
    from (select ${currentValue} as "value") as "psto_display_current")`
}
