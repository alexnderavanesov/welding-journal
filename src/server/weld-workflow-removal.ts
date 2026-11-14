import { LNK_METHODS } from '@/lib/lnk-report-config'
import { isFinalLnkResultValue } from '@/lib/lnk-status'
import { hasText, isPendingLnkResultValue, normalizeControlResultText } from '@/lib/report-value-utils'
import { normalizeTvmtResult } from '@/lib/tvmt-cycle'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { WeldMutationScope } from './weld-contracts'

// Historical NK also contains «да» / «не годен». These are recorded facts,
// just as in control-assignment-history, even though new NK uses three values.
export function hasStoredLnkResult(value: unknown) {
  return isFinalLnkResultValue(value) || Boolean(normalizeTvmtResult(value))
}

/** Protect opaque historical text from deletion without classifying it as a
 * completed process. Known waiting/cancellation placeholders are not facts. */
function hasProtectedStoredResult(value: unknown) {
  const text = normalizeControlResultText(value)
  return Boolean(text && text !== '-' && text !== 'отменен' && !isPendingLnkResultValue(text))
}

/** Compare the locked stored row with the final merged, scope-restricted draft. */
export function isWeldWorkflowRemoval(record: WeldInput, previous: WeldInput | undefined, scope: WeldMutationScope) {
  if (!previous) return false
  const removesDocument = (name: WeldFieldKey, date: WeldFieldKey) => (
    hasText(previous[name]) && !hasText(record[name]) ||
    !hasText(previous[name]) && hasText(previous[date]) && !hasText(record[name]) && !hasText(record[date])
  )
  if (scope === 'lnk') return LNK_METHODS.some(method =>
    removesDocument(method.requestKey, method.requestDateKey) || removesDocument(method.conclusionKey, method.conclusionDateKey) ||
    hasProtectedStoredResult(previous[method.resultKey]) && !hasProtectedStoredResult(record[method.resultKey]))
  if (scope === 'psto') return (
    removesDocument('pstoRequest', 'pstoRequestDate') || removesDocument('heatTreatmentDiagram', 'pstoDate') ||
    removesDocument('tvmtRequest', 'tvmtRequestDate') || removesDocument('tvmtConclusion', 'tvmtConclusionDate') ||
    hasProtectedStoredResult(previous.pstoResult) && !hasProtectedStoredResult(record.pstoResult) ||
    hasProtectedStoredResult(previous.tvmtResult) && !hasProtectedStoredResult(record.tvmtResult)
  )
  return false
}
