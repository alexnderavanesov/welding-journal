import { normalizeControlResultText } from '@/lib/report-value-utils'
import type { WeldRow } from './dispatcher-types'
import type { WeldInput, WeldFieldKey } from './weld-fields'
import { LNK_METHODS, TVMT_METHOD } from './lnk-report-config'
import { isControlCancelledValue, isControlEnabledValue } from './control-availability-values'
import { hasRealLnkResultValue, hasText } from './report-value-utils'

const METHODS = [...LNK_METHODS, TVMT_METHOD] as const
const assigned = (value: unknown) => isControlEnabledValue(value) || isControlCancelledValue(value)
const resultFact = (value: unknown) => hasRealLnkResultValue(value) || ['не годен', 'негоден', 'да', 'годен (отменен)', 'проведено', 'проведено (отменен)'].includes(normalizeControlResultText(value))
export const HISTORY_ASSIGNMENTS = [...METHODS, { code: 'ПСТО', enabledKey: 'pstoRequired' }] as const

/** A waiting label is not a started process. History belongs to this method and its own stages. */
export function getControlAssignmentHistory(row: WeldInput, field: WeldFieldKey): string | null {
  const hydrated = row as Partial<WeldRow>
  const method = METHODS.find(method => method.enabledKey === field)
  if (method) {
    if ([method.requestKey, method.requestDateKey, method.conclusionKey, method.conclusionDateKey].some(key => hasText(row[key])) || resultFact(row[method.resultKey])) return `${method.code}: основной этап`
    if (hydrated.preHeatTreatmentControls?.some(control => control.method === method.code &&
      ([control.requestName, control.requestDate, control.conclusionName, control.conclusionDate].some(hasText) || resultFact(control.result)))) return `${method.code}: НК до ТО`
    if (hydrated.duplicateControls?.some(control => control.method === method.code &&
      ([control.conclusion, control.conclusionDate, control.controlDate].some(hasText) || resultFact(control.result)))) return `${method.code}: дубль контроля`
    if (field === 'hasTvmt' && hydrated.pstoRepeatCycles?.some(cycle =>
      [cycle.tvmtRequest, cycle.tvmtRequestDate, cycle.tvmtConclusion, cycle.tvmtConclusionDate].some(hasText) || resultFact(cycle.tvmtResult))) return 'ТВМТ: повторный цикл'
  }
  if (field === 'pstoRequired') {
    if ([row.pstoRequest, row.pstoRequestDate, row.pstoDate, row.heatTreatmentDiagram, row.tvmtRequest, row.tvmtRequestDate, row.tvmtConclusion, row.tvmtConclusionDate].some(hasText) || resultFact(row.pstoResult) || resultFact(row.tvmtResult)) return 'ПСТО / ТВМТ: основной цикл'
    if (hydrated.pstoRepeatCycles?.some(cycle =>
      [cycle.pstoRequest, cycle.pstoRequestDate, cycle.pstoDate, cycle.heatTreatmentDiagram, cycle.tvmtRequest, cycle.tvmtRequestDate, cycle.tvmtConclusion, cycle.tvmtConclusionDate].some(hasText) || resultFact(cycle.pstoResult) || resultFact(cycle.tvmtResult))) return 'ПСТО / ТВМТ: повторный цикл'
    if (hydrated.preHeatTreatmentControls?.some(control =>
      [control.requestName, control.requestDate, control.conclusionName, control.conclusionDate].some(hasText) || resultFact(control.result))) return 'ПСТО: НК до ТО'
  }
  return null
}

/** Mandatory transition protection, independent of optional legacy-data checks. */
export function getControlAssignmentRemovalReason(record: WeldInput, previous?: WeldInput): string {
  return getControlAssignmentRemovalIssues(record, previous).map(issue => issue.message).join(' ')
}

export function getControlAssignmentRemovalIssues(record: WeldInput, previous?: WeldInput): Array<{ fieldKey: WeldFieldKey; message: string }> {
  if (!previous) return []
  const issues: Array<{ fieldKey: WeldFieldKey; message: string }> = []
  for (const { code, enabledKey } of HISTORY_ASSIGNMENTS) {
    if (!assigned(previous[enabledKey]) || assigned(record[enabledKey])) continue
    const history = getControlAssignmentHistory(previous, enabledKey) || getControlAssignmentHistory(record, enabledKey)
    if (history) issues.push({ fieldKey: enabledKey, message: `${code}: нельзя снять назначение через «Пусто» — есть заявка, результат или заключение (${history}). Для официальной отмены выберите «Отменен»; история сохранится.` })
  }
  return issues
}

export function getControlAssignmentCancellations(record: WeldInput, previous: WeldInput): string[] {
  return HISTORY_ASSIGNMENTS.filter(({ enabledKey }) => isControlCancelledValue(record[enabledKey]) && !isControlCancelledValue(previous[enabledKey]) &&
    (getControlAssignmentHistory(previous, enabledKey) || getControlAssignmentHistory(record, enabledKey))).map(({ code }) => code)
}
