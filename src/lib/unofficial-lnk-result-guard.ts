import { isUnofficialJoint } from './joint-display'
import { LNK_METHODS } from './lnk-report-config'
import { normalizeResultStatus } from './weld-status'
import { getPreHeatTreatmentControls } from './lnk-control-stage'
import { getDuplicateControls } from './duplicate-control-utils'
import type { WeldFieldKey, WeldInput } from './weld-fields'
import type { WeldRow } from './dispatcher-types'

type OfficialityResultRow = WeldInput & Partial<Pick<WeldRow, 'duplicateControls' | 'preHeatTreatmentControls'>>

/** Check the complete final record, including other methods and stages. Moving
 * a rejection between stages retains it; clearing the last factual rejection does not. */
export function getUnofficialLastRejectionRemovalReason(next: OfficialityResultRow, previous?: OfficialityResultRow) {
  if (!previous || !isUnofficialJoint(previous) || !hasStoredRejection(previous) || hasStoredRejection(next)) return null
  return `Стык ${String(previous.joint ?? '').trim() || 'без номера'}: нельзя удалить или очистить последний негодный результат НК у неофициального стыка. Сначала верните стыку официальность через ЛНК → «Официальность» и сохраните её, затем удалите ошибочный результат. Данные не изменены.`
}

function hasStoredRejection(row: WeldInput) {
  // A disabled stage suspends its workflow, not the existence of its saved facts.
  return [...LNK_METHODS.map(method => row[method.resultKey]),
    ...getPreHeatTreatmentControls(row).map(control => control.result),
    ...getDuplicateControls(row).map(control => control.result),
  ].some(result => ['ремонт', 'вырез'].includes(normalizeResultStatus(result) ?? ''))
}

export function assertUnofficialLastRejectionRetained(next: OfficialityResultRow, previous: OfficialityResultRow) {
  const reason = getUnofficialLastRejectionRemovalReason(next, previous)
  if (reason) throw new Error(reason)
}

/** Compare facts, not finalStatus: a different method can already be good on a
 * rejected unofficial joint. An empty/waiting intermediate value is no bypass. */
export function getUnofficialLnkGoodResultReason(
  row: WeldInput,
  nextResult: unknown,
  previousResult: unknown,
  method: string,
) {
  if (!isUnofficialJoint(row) || normalizeResultStatus(nextResult) !== 'годен' ||
    normalizeResultStatus(previousResult) === 'годен') return null
  return `Стык ${String(row.joint ?? '').trim() || 'без номера'}: нельзя установить «годен» для ${method} на неофициальном стыке. Сначала верните стыку официальность через ЛНК → «Официальность», сохраните её, затем исправьте результат.`
}

export function assertUnofficialLnkGoodResultAllowed(
  ...args: Parameters<typeof getUnofficialLnkGoodResultReason>
) {
  const reason = getUnofficialLnkGoodResultReason(...args)
  if (reason) throw new Error(reason)
}

export function getUnofficialLnkResultIssues(next: WeldInput, previous?: WeldInput) {
  // Restoring officiality and replacing a result must be separate operations.
  const protectedRow = previous && isUnofficialJoint(previous) ? previous : next
  const issues: Array<{ message: string; fieldKeys: WeldFieldKey[] }> = LNK_METHODS.flatMap(method => {
    const message = getUnofficialLnkGoodResultReason(protectedRow, next[method.resultKey], previous?.[method.resultKey], method.code)
    return message ? [{ message, fieldKeys: [method.resultKey] }] : []
  })
  const removalReason = getUnofficialLastRejectionRemovalReason(next, previous)
  if (removalReason) {
    const removedKeys = LNK_METHODS.filter(method =>
      ['ремонт', 'вырез'].includes(normalizeResultStatus(previous?.[method.resultKey]) ?? '') &&
      !['ремонт', 'вырез'].includes(normalizeResultStatus(next[method.resultKey]) ?? ''),
    ).map(method => method.resultKey)
    issues.push({ message: removalReason, fieldKeys: removedKeys.length ? removedKeys : ['officiality'] })
  }
  return issues
}
