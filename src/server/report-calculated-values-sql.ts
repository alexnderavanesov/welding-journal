import { sql, type SQLWrapper } from 'drizzle-orm'
import { weldJoints } from '@/db/schema'
import { CONTROL_ASSIGNMENT_BASIS_FIELDS } from '@/lib/control-assignment-basis'
import type { OtherSettings } from '@/lib/other-settings'
import { LNK_METHODS } from '@/lib/report-config'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { isSystemWdiMode } from '@/lib/wdi'
import type { WeldReportKind } from './weld-contracts'
import { buildCurrentWdiSqlExpression } from './current-wdi-sql'
import { buildPstoCurrentReportValueSql } from './psto-report-current-values'
import { buildPstoCycleSummarySql } from './psto-cycle-summary-sql'
import { buildPreControlReportValueSql } from './report-pre-control-filter-sql'
import { buildRkExposureSchemeSql } from './report-rk-filter-sql'
import { cancelledLnkResultSql, reportResultSql, reportTextSql } from './report-filter-text-sql'

/** Values for selection/facets only. Full cards keep stored facts and history. */
export function buildCalculatedReportValueSql(
  report: WeldReportKind, fieldKey: WeldFieldKey, settings: OtherSettings,
): SQLWrapper | undefined {
  if (fieldKey === 'wdi' && isSystemWdiMode(settings)) {
    // The application matcher sees a JS number, without numeric scale zeros.
    return sql`(${buildCurrentWdiSqlExpression(settings, weldJoints)})::double precision`
  }
  if (fieldKey === 'rkExposureScheme') return buildRkExposureSchemeSql(settings.rkExposureTable)
  if (fieldKey === 'controlBasisSummary') {
    if (report === 'heatTreatment') return sql`''::text`
    return sql`concat_ws('; ', ${sql.join(CONTROL_ASSIGNMENT_BASIS_FIELDS.map(field => sql`
      case when ${reportTextSql(weldJoints[field.basisKey])} <> ''
        then ${field.code + ': '} || ${reportTextSql(weldJoints[field.basisKey])} end`), sql`, `)})`
  }
  const preValue = buildPreControlReportValueSql(fieldKey)
  if (preValue) return preValue
  if (report === 'heatTreatment') {
    if (fieldKey === 'pstoCycleSummary') return buildPstoCycleSummarySql()
    const current = buildPstoCurrentReportValueSql(fieldKey)
    if (current) return current
  }
  if (report !== 'weldingJournal') {
    const method = LNK_METHODS.find(method => method.resultKey === fieldKey)
    if (method) return sql`case when lower(${reportTextSql(weldJoints[method.enabledKey])}) = 'отменен'
      then ${cancelledLnkResultSql(weldJoints[method.resultKey])} else ${weldJoints[method.resultKey]} end`
    if (fieldKey === 'pstoResult') return sql`case when lower(${reportTextSql(weldJoints.pstoRequired)}) = 'отменен'
      then case when ${reportResultSql(weldJoints.pstoResult)} in ('проведено', 'да', 'проведено (отменен)')
        then 'проведено · назначение отменено' else 'отменен' end else ${weldJoints.pstoResult} end`
  }
  return undefined
}
