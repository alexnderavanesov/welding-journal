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
  return getAssignmentHistory(row, field, true, true)
}

/** Own performed work survives changes to visibility and applies to both NK stages.
 * Requests alone do not prove execution. Preliminary NK is not performed PSTO. */
export function getControlAssignmentPerformedHistory(row: WeldInput, field: WeldFieldKey): string | null {
  return getAssignmentHistory(row, field, false, false)
}

/** Clearing PSTO must also retain its recorded preliminary package. An explicit
 * contextual stage transfer is a separate, validated workflow. */
export function getControlAssignmentRemovalHistory(row: WeldInput, field: WeldFieldKey): string | null {
  return getAssignmentHistory(row, field, false, true)
}

function getAssignmentHistory(row: WeldInput, field: WeldFieldKey, includeRequests: boolean, includePrePsto: boolean): string | null {
  const hydrated = row as Partial<WeldRow>
  const method = METHODS.find(method => method.enabledKey === field)
  if (method) {
    if ([method.conclusionKey, method.conclusionDateKey, ...(method.defectDescriptionKey ? [method.defectDescriptionKey] : []), ...(method.code === 'РК' ? ['rkExposureConfirmedDiameter' as const] : []), ...(includeRequests ? [method.requestKey, method.requestDateKey] : [])].some(key => hasText(row[key])) || resultFact(row[method.resultKey])) return `${method.code}: основной этап`
    if (hydrated.preHeatTreatmentControls?.some(control => control.method === method.code &&
      ([control.conclusionName, control.conclusionDate, control.defectDescription, control.rkExposureConfirmedDiameter, ...(includeRequests ? [control.requestName, control.requestDate] : [])].some(hasText) || resultFact(control.result)))) return `${method.code}: НК до ТО`
    if (hydrated.duplicateControls?.some(control => control.method === method.code &&
      ([control.conclusion, control.conclusionDate, control.controlDate].some(hasText) || resultFact(control.result)))) return `${method.code}: дубль контроля`
    if (field === 'hasTvmt' && hydrated.pstoRepeatCycles?.some(cycle =>
      [cycle.tvmtConclusion, cycle.tvmtConclusionDate, ...(includeRequests ? [cycle.tvmtRequest, cycle.tvmtRequestDate] : [])].some(hasText) || resultFact(cycle.tvmtResult))) return 'ТВМТ: повторный цикл'
  }
  if (field === 'pstoRequired') {
    if ([row.pstoDate, row.heatTreatmentDiagram, row.tvmtConclusion, row.tvmtConclusionDate, ...(includeRequests ? [row.pstoRequest, row.pstoRequestDate, row.tvmtRequest, row.tvmtRequestDate] : [])].some(hasText) || resultFact(row.pstoResult) || resultFact(row.tvmtResult)) return 'ПСТО / ТВМТ: основной цикл'
    if (hydrated.pstoRepeatCycles?.some(cycle =>
      [cycle.pstoDate, cycle.heatTreatmentDiagram, cycle.tvmtConclusion, cycle.tvmtConclusionDate, ...(includeRequests ? [cycle.pstoRequest, cycle.pstoRequestDate, cycle.tvmtRequest, cycle.tvmtRequestDate] : [])].some(hasText) || resultFact(cycle.pstoResult) || resultFact(cycle.tvmtResult))) return 'ПСТО / ТВМТ: повторный цикл'
    if (includePrePsto && hydrated.preHeatTreatmentControls?.some(control =>
      [control.conclusionName, control.conclusionDate, control.defectDescription, control.rkExposureConfirmedDiameter, ...(includeRequests ? [control.requestName, control.requestDate] : [])].some(hasText) || resultFact(control.result))) return 'ПСТО: НК до ТО'
  }
  return null
}

/** Mandatory transition protection, independent of optional legacy-data checks. */
export function getControlAssignmentRemovalReason(record: WeldInput, previous?: WeldInput): string {
  return getControlAssignmentRemovalIssues(record, previous).map(issue => issue.message).join(' ')
}

export function getControlAssignmentRemovalIssues(record: WeldInput, previous?: WeldInput): Array<{ fieldKey: WeldFieldKey; message: string }> {
  const issues: Array<{ fieldKey: WeldFieldKey; message: string }> = []
  for (const { code, enabledKey } of HISTORY_ASSIGNMENTS) {
    const previousFact = previous && getControlAssignmentPerformedHistory(previous, enabledKey)
    const currentFact = getControlAssignmentPerformedHistory(record, enabledKey)
    const cancels = isControlCancelledValue(record[enabledKey]) && (!isControlCancelledValue(previous?.[enabledKey]) || (!previousFact && currentFact))
    if (cancels && (previousFact || currentFact)) {
      issues.push({ fieldKey: enabledKey, message: `${code}: нельзя отменить выполненный контроль (${previousFact || currentFact}). Годные и негодные результаты сохраняются; ошибочный результат исправляется в профильном процессе.` })
      continue
    }
    if (!previous || !assigned(previous[enabledKey]) || assigned(record[enabledKey])) continue
    const history = getControlAssignmentRemovalHistory(previous, enabledKey) || getControlAssignmentRemovalHistory(record, enabledKey)
    if (history) issues.push({ fieldKey: enabledKey, message: `${code}: нельзя снять назначение через «Пусто» — есть выполненная работа или её реквизиты (${history}). Исправьте ошибочный результат в профильном процессе; снятие не удаляет факты.` })
  }
  return issues
}

export function getControlAssignmentCancellations(record: WeldInput, previous: WeldInput): string[] {
  return HISTORY_ASSIGNMENTS.filter(({ enabledKey }) => isControlCancelledValue(record[enabledKey]) && !isControlCancelledValue(previous[enabledKey]) &&
    !getControlAssignmentPerformedHistory(previous, enabledKey) && !getControlAssignmentPerformedHistory(record, enabledKey) &&
    (getControlAssignmentHistory(previous, enabledKey) || getControlAssignmentHistory(record, enabledKey))).map(({ code }) => code)
}
