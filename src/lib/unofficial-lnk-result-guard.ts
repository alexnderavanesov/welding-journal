import { isUnofficialJoint } from './joint-display'
import { LNK_METHODS } from './lnk-report-config'
import { normalizeResultStatus } from './weld-status'
import type { WeldInput } from './weld-fields'

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
  return LNK_METHODS.flatMap(method => {
    const message = getUnofficialLnkGoodResultReason(protectedRow, next[method.resultKey], previous?.[method.resultKey], method.code)
    return message ? [{ message, fieldKeys: [method.resultKey] }] : []
  })
}
