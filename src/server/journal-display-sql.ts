import { sql, type SQLWrapper } from 'drizzle-orm'
import { weldJoints } from '@/db/schema'
import { CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES } from '@/lib/control-availability-values'
import { LNK_METHODS } from '@/lib/report-config'
import { FIELD_BY_KEY, isVirtualWeldField, type WeldFieldKey } from '@/lib/weld-fields'
import { buildPstoCurrentReportValueSql, buildReportHasRejectedLnkSql } from './psto-report-current-values'
import { cancelledLnkResultSql, reportResultSql, reportTextSql } from './report-filter-text-sql'
import type { WeldReportKind } from './weld-contracts'

/** Journal display preparation changes control labels without changing stored facts.
 * Group keys must use those same labels, including waiting and cancelled controls. */
export function journalControlValueSql(key: WeldFieldKey): SQLWrapper | undefined {
  if (key === 'pstoRequest') return reportTextSql(weldJoints.pstoRequest)
  const flagKey = key === 'pstoRequired' || LNK_METHODS.some(method => method.enabledKey === key) ? key as keyof typeof weldJoints.$inferSelect : undefined
  if (flagKey) {
    const raw = weldJoints[flagKey]
    const flag = sql`lower(${reportTextSql(raw)})`
    return sql`case when ${flag} = 'отменен' then 'отменен'
      ${key === 'hasVik' ? sql`when ${reportTextSql(weldJoints.weldDate)} <> '' and not (${flag} = any(${sql.param([...CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES])}::text[])) then 'true'` : sql``}
      else ${raw}::text end`
  }
  if (key === 'pstoResult') return buildPstoCurrentReportValueSql(key)
  const method = LNK_METHODS.find(method => method.resultKey === key)
  if (!method) return undefined
  const flag = sql`lower(${reportTextSql(weldJoints[method.enabledKey])})`
  const enabled = sql`(${flag} = any(${sql.param([...CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES])}::text[])
    ${method.code === 'ВИК' ? sql`or (${reportTextSql(weldJoints.weldDate)} <> '' and ${flag} <> 'отменен')` : sql``})`
  const raw = reportTextSql(weldJoints[method.resultKey])
  const result = reportResultSql(raw)
  const requested = sql`${reportTextSql(weldJoints[method.requestKey])} <> ''`
  return sql`case
    when ${flag} = 'отменен' then ${cancelledLnkResultSql(raw)}
    when ${buildReportHasRejectedLnkSql()} and ${result} not in ('годен', 'ремонт', 'вырез', 'годен (отменен)')
      and (${enabled} or ${requested}) then 'нет потребности'
    when ${enabled} and (${raw} = '' or lower(${raw}) in ('ожидает', 'ожидает нк', 'ожидает заявку'))
      then case when ${requested} then 'ожидает НК' else 'ожидает заявку' end
    when not ${enabled} and not ${requested} and ${reportTextSql(weldJoints[method.requestDateKey])} = ''
      and lower(${raw}) in ('ожидает', 'ожидает нк', 'ожидает заявку') then ''
    else ${raw} end`
}

// These stored scalar values have no client-side control/document decoration.
// Aggregate/copy them directly, without hydrating complete cards for each row.
const preparedFields = new Set<string>(['hasVik', 'pstoRequired', 'pstoRequest', 'pstoResult', 'finalStatus',
  ...LNK_METHODS.flatMap(method => [method.enabledKey, method.requestKey, method.requestDateKey, method.resultKey])])
const pstoDisplayFields = new Set(['pstoRequest', 'pstoRequestDate', 'pstoDate', 'heatTreatmentDiagram', 'pstoResult', 'pstoNote',
  'tvmtRequest', 'tvmtRequestDate', 'tvmtResult', 'tvmtConclusionDate', 'tvmtConclusion', 'pstoControlBasis', 'pstoCancellationDate'])
export function isJournalScalarField(key: WeldFieldKey, report: WeldReportKind = 'weldingJournal') {
  const field = FIELD_BY_KEY.get(key)
  return Boolean(field && !isVirtualWeldField(field) && !preparedFields.has(key) && !(report === 'heatTreatment' && pstoDisplayFields.has(key)))
}
