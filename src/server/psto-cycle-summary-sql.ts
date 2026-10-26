import { sql } from 'drizzle-orm'
import { preHeatTreatmentControls, weldJoints } from '@/db/schema'
import { CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES } from '@/lib/control-availability-values'
import { PRE_HEAT_TREATMENT_LNK_METHODS } from '@/lib/lnk-control-stage'
import { buildNullableControlEnabledWhere } from './control-availability-sql'
import { buildPreHeatTreatmentEnabledWhere } from './pre-heat-treatment-policy'
import { preControlValueSql } from './report-pre-control-filter-sql'
import { reportResultSql, reportTextSql } from './report-filter-text-sql'
import { buildPstoCurrentCycleQuery, buildReportHasRejectedLnkSql } from './psto-report-current-values'

/** getPstoCycleDisplaySummary on the report projection (including auto VIK).
 * The selected cycle remains factual; none of these labels are saved. */
export function buildPstoCycleSummarySql() {
  const active = buildNullableControlEnabledWhere(weldJoints.pstoRequired, CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES)
  const cancelled = sql`lower(${reportTextSql(weldJoints.pstoRequired)}) = 'отменен'`
  const keys = ['pstoRequest', 'pstoResult', 'tvmtRequest', 'tvmtResult'] as const
  const selected = buildPstoCurrentCycleQuery(keys)
  const current = (key: string) => sql`${sql.identifier('summary_cycle')}.${sql.identifier(key)}`
  const result = reportResultSql(current('pstoResult'))
  const tvmtResult = reportResultSql(current('tvmtResult'))
  const methods = PRE_HEAT_TREATMENT_LNK_METHODS.map(method => {
    const assigned = buildNullableControlEnabledWhere(weldJoints[method.enabledKey], CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES)
    return {
      ...method,
      enabled: method.code === 'ВИК' ? sql`((${weldJoints.weldDate} is not null
        and lower(${reportTextSql(weldJoints.hasVik)}) <> 'отменен') or ${assigned})` : assigned,
      result: sql`lower(${reportTextSql(preControlValueSql(method.code, preHeatTreatmentControls.result))})`,
      request: reportTextSql(preControlValueSql(method.code, preHeatTreatmentControls.requestName)),
    }
  })
  const rejected = sql<string>`concat_ws(', ', ${sql.join(methods.map(method => sql`case when
    (${method.enabled} or lower(${reportTextSql(weldJoints[method.enabledKey])}) = 'отменен')
    and ${method.result} in ('ремонт', 'вырез') then ${method.code} end`), sql`, `)})`
  const list = (kind: 'missing' | 'pending') => sql<string>`concat_ws(', ', ${sql.join(methods.map(method => sql`
    case when ${method.enabled} and ${kind === 'missing' ? sql`${method.request} = ''` : sql`${method.result} <> 'годен'`}
      then ${method.code} end`), sql`, `)})`
  // Each list is evaluated once, and later prerequisites are read only if the
  // preceding one is empty. Repeating a correlated expression in WHEN/THEN
  // multiplied both execution and PostgreSQL JIT compilation work.
  const prerequisites = sql<string>`case when ${buildPreHeatTreatmentEnabledWhere()} then coalesce(
    'НК до ТО не годен: ' || nullif(${rejected}, ''),
    case when ${active} then coalesce(
      'ожидает заявку НК до ТО: ' || nullif(${list('missing')}, ''),
      'ожидает НК до ТО: ' || nullif(${list('pending')}, '')) end, '') else '' end`
  const state = sql<string>`case
    when ${current('pstoRequest')} = '' then coalesce(
      case when ${current('sequence')} = 1 then nullif(${prerequisites}, '') end, 'ожидает заявку ПСТО')
    when ${result} not in ('проведено', 'проведено (отменен)', 'да') then 'ожидает ПСТО'
    when ${current('tvmtRequest')} = '' then 'ожидает заявку ТВМТ'
    when ${tvmtResult} in ('годен', 'да') then 'цикл завершен'
    when ${tvmtResult} in ('не годен', 'негоден', 'ремонт', 'вырез') then
      case when ${active} then 'требуется повторная ПСТО' else 'цикл завершен' end
    else 'ожидает ТВМТ' end`
  return sql<string>`(select case
    when ${active} and case when ${result} in ('проведено', 'проведено (отменен)', 'отменен')
      then false else ${buildReportHasRejectedLnkSql()} end
      then 'нет потребности'
    when not (${active}) and not ${current('performed')} then case when ${cancelled} then 'ПСТО отменено' else 'не требуется' end
    else (case when ${current('sequence')} >= 2 then 'Повтор #' || ${current('sequence')}::text else 'Основной' end)
      || ' · ' || ${state} || case when ${cancelled} then ' · линия отменена' else '' end
    end from (${selected}) as "summary_cycle")`
}
