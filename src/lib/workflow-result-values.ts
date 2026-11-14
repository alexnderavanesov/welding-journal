import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from './weld-fields'
import { isFinalLnkResultValue } from './lnk-status'
import { isCompletedPstoResult, normalizeTvmtResult } from './tvmt-cycle'
import { normalizeControlResultText } from './report-value-utils'

const resultFields = ['vikResult', 'rkResult', 'uzkResult', 'pvkResult', 'pstoResult', 'tvmtResult'] as const
const pendingOrCancelled = new Set(['ожидает', 'ожидает нк', 'ожидает заявку', 'отменен'])

/** Validate the fact that persistence will store. Only changed values are
 * canonicalized; an unrelated edit must not turn old history into a new fact. */
export function canonicalizeChangedWorkflowResults(record: WeldInput, previous?: WeldInput): WeldInput {
  let result = record
  for (const field of resultFields) {
    const value = record[field]
    if (typeof value !== 'string' || previous && value === previous[field]) continue
    const text = normalizeControlResultText(value)
    const tvmt = field === 'tvmtResult' ? normalizeTvmtResult(value) : null
    const canonical = field === 'pstoResult' ? isCompletedPstoResult(value) ? 'проведено' : null
      : field === 'tvmtResult' ? tvmt === 'failed' ? 'не годен' : tvmt === 'good' || text === 'годен (отменен)' ? 'годен' : null
        : text === 'да' || text === 'годен (отменен)' ? 'годен' : ['годен', 'ремонт', 'вырез'].includes(text) ? text : null
    if (canonical !== null && canonical !== value) result = { ...result, [field]: canonical }
  }
  return result
}

/** Validate new values without normalizing stored facts or demanding that an
 * unrelated edit repairs old history. Workflow annotations retain their fact. */
export function getWorkflowResultValueIssues(record: WeldInput, previous?: WeldInput) {
  return resultFields.flatMap(field => {
    if (!Object.hasOwn(record, field) || previous && record[field] === previous[field]) return []
    const value: unknown = record[field]
    if (value == null) return []
    const text = typeof value === 'string' ? normalizeControlResultText(value) : null
    if (text !== null && (!text || pendingOrCancelled.has(text) || (field === 'pstoResult'
      ? isCompletedPstoResult(value) : field === 'tvmtResult'
        ? isFinalLnkResultValue(value) || Boolean(normalizeTvmtResult(value))
        : isFinalLnkResultValue(value) || text === 'да'))) return []
    return [{ fieldKeys: [field] as WeldFieldKey[], message: `Поле «${FIELD_BY_KEY.get(field)!.label}»: значение не распознано. Выберите допустимый результат в окне соответствующего этапа.` }]
  })
}
