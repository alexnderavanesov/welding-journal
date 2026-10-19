import { or, sql, type SQLWrapper } from 'drizzle-orm'
import { preHeatTreatmentControls, weldJoints } from '@/db/schema'
import { CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES } from '@/lib/control-availability-values'
import { PRE_HEAT_TREATMENT_LNK_METHODS } from '@/lib/lnk-control-stage'
import { getPreHeatTreatmentReportField } from '@/lib/pre-heat-treatment-report-fields'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { cancelledLnkResultSql, reportTextSql } from './report-filter-text-sql'
import { rkDescriptionPartsSql } from './report-rk-filter-sql'

export function preControlValueSql(method: string, column: SQLWrapper) {
  return sql<string>`${sql`(select ${column} from ${preHeatTreatmentControls}
    where ${preHeatTreatmentControls.weldJointId} = ${weldJoints.id}
      and ${preHeatTreatmentControls.method} = ${method}
    order by ${preHeatTreatmentControls.id} limit 1)`}`
}

/** Projection is attached before attachCurrentPolicy, as in the existing
 * mergePreHeatTreatmentControlsIntoRows. Do not silently change that contract
 * to a current-policy display projection during query optimization. */
export function buildPreControlReportValueSql(fieldKey: WeldFieldKey) {
  const field = getPreHeatTreatmentReportField(fieldKey)
  if (!field) return undefined
  const raw = field.valueKey === 'exposureScheme' || field.valueKey === 'defectDescription'
    ? preControlValueSql(field.methodCode, preHeatTreatmentControls.defectDescription)
    : preControlValueSql(field.methodCode, preHeatTreatmentControls[field.valueKey])
  if (field.valueKey === 'exposureScheme' || field.valueKey === 'defectDescription' && field.methodCode === 'РК') {
    return sql<string>`array_to_string(${rkDescriptionPartsSql(raw, field.valueKey === 'exposureScheme' ? 'coordinate' : 'description')}, ${field.valueKey === 'exposureScheme' ? ', ' : '; '})`
  }
  if (field.valueKey !== 'result') return raw
  const method = PRE_HEAT_TREATMENT_LNK_METHODS.find(method => method.code === field.methodCode)!
  const activeRejectMethod = or(...PRE_HEAT_TREATMENT_LNK_METHODS.map(method => sql`(
    ${preHeatTreatmentControls.method} = ${method.code}
    and lower(${reportTextSql(weldJoints[method.enabledKey])}) = any(${sql.param([...CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES, 'отменен'])}::text[]))`))!
  const rejected = sql`exists (select 1 from ${preHeatTreatmentControls}
    where ${preHeatTreatmentControls.weldJointId} = ${weldJoints.id} and ${activeRejectMethod}
      and lower(${reportTextSql(preHeatTreatmentControls.result)}) in ('ремонт', 'вырез'))`
  return sql<string>`case
    when lower(${reportTextSql(weldJoints[method.enabledKey])}) = 'отменен' then ${cancelledLnkResultSql(raw)}
    when ${rejected} and lower(${reportTextSql(raw)}) not in ('годен', 'ремонт', 'вырез') then 'нет потребности'
    else ${raw} end`
}
