import { sql } from 'drizzle-orm'
import { preHeatTreatmentControls, pstoRepeatCycles, weldJoints } from '@/db/schema'
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
  const selected = buildPstoCurrentCycleQuery(
    sql.join(keys.map(key => sql`${reportTextSql(weldJoints[key])} as ${sql.identifier(key)}`), sql`, `),
    sql.join(keys.map(key => sql`${reportTextSql(pstoRepeatCycles[key])} as ${sql.identifier(key)}`), sql`, `),
  )
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
  const prerequisites = sql<string>`case when ${buildPreHeatTreatmentEnabledWhere()} then
    case when ${rejected} <> '' then 'НК до ТО не годен: ' || ${rejected}
      when ${active} and ${list('missing')} <> '' then 'ожидает заявку НК до ТО: ' || ${list('missing')}
      when ${active} and ${list('pending')} <> '' then 'ожидает НК до ТО: ' || ${list('pending')} else '' end else '' end`
  const state = sql<string>`case
    when ${current('pstoRequest')} = '' then case when ${current('sequence')} = 1 and ${prerequisites} <> ''
      then ${prerequisites} else 'ожидает заявку ПСТО' end
    when ${result} not in ('проведено', 'проведено (отменен)', 'да') then 'ожидает ПСТО'
    when ${current('tvmtRequest')} = '' then 'ожидает заявку ТВМТ'
    when ${tvmtResult} in ('годен', 'да') then 'цикл завершен'
    when ${tvmtResult} in ('не годен', 'негоден', 'ремонт', 'вырез') then
      case when ${active} then 'требуется повторная ПСТО' else 'цикл завершен' end
    else 'ожидает ТВМТ' end`
  return sql<string>`(select case
    when ${active} and ${buildReportHasRejectedLnkSql()} and ${result} not in ('проведено', 'проведено (отменен)', 'отменен')
      then 'нет потребности'
    when not (${active}) and not ${current('performed')} then case when ${cancelled} then 'ПСТО отменено' else 'не требуется' end
    else (case when ${current('sequence')} >= 2 then 'Повтор #' || ${current('sequence')}::text else 'Основной' end)
      || ' · ' || ${state} || case when ${cancelled} then ' · линия отменена' else '' end
    end from (${selected}) as "summary_cycle")`
}
