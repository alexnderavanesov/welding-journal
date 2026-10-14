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

function rejectedMethods(row: OfficialityResultRow) {
  return new Set([
    ...LNK_METHODS.map(method => ({ method: method.code, result: row[method.resultKey] })),
    ...getPreHeatTreatmentControls(row),
    ...getDuplicateControls(row),
  ].filter(control => ['ремонт', 'вырез'].includes(normalizeResultStatus(control.result) ?? ''))
    .map(control => control.method))
}

/** Backfill is not correction of a rejection. Require another method's stored
 * rejection on both sides of the save; a derived status is not historical evidence. */
export function getUnofficialLnkGoodResultReason(
  row: OfficialityResultRow,
  nextResult: unknown,
  previousResult: unknown,
  method: string,
  { nextRow = row, allowBackfill = true }: { nextRow?: OfficialityResultRow; allowBackfill?: boolean } = {},
) {
  if (!isUnofficialJoint(row) || normalizeResultStatus(nextResult) !== 'годен' ||
    normalizeResultStatus(previousResult) === 'годен') return null
  const methodCode = LNK_METHODS.find(candidate => method === candidate.code || method === `${candidate.code} до ТО`)?.code
  if (allowBackfill && methodCode && !['ремонт', 'вырез'].includes(normalizeResultStatus(previousResult) ?? '')) {
    const retained = rejectedMethods(nextRow)
    if ([...rejectedMethods(row)].some(code => code !== methodCode && retained.has(code))) return null
  }
  return `Стык ${String(row.joint ?? '').trim() || 'без номера'}: нельзя установить «годен» для ${method} на неофициальном стыке. Сначала верните стыку официальность через ЛНК → «Официальность», сохраните её, затем исправьте результат.`
}

export function assertUnofficialLnkGoodResultAllowed(
  ...args: Parameters<typeof getUnofficialLnkGoodResultReason>
) {
  const reason = getUnofficialLnkGoodResultReason(...args)
  if (reason) throw new Error(reason)
}

export function getUnofficialLnkResultIssues(next: OfficialityResultRow, previous?: OfficialityResultRow) {
  // Restoring officiality and replacing a result must be separate operations.
  const protectedRow = previous && isUnofficialJoint(previous) ? previous : next
  const issues: Array<{ message: string; fieldKeys: WeldFieldKey[] }> = LNK_METHODS.flatMap(method => {
    const message = getUnofficialLnkGoodResultReason(protectedRow, next[method.resultKey], previous?.[method.resultKey], method.code, {
      nextRow: next,
      allowBackfill: Boolean(previous && isUnofficialJoint(previous)),
    })
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
