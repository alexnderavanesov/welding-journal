import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkResultRestrictionReasons } from '@/lib/lnk-result-policy'

export function getLnkSelectionResultRestrictionReason(
  rows: readonly WeldRow[],
  methodCodes: readonly string[],
  result: string,
  options: Parameters<typeof getLnkResultRestrictionReasons>[3] & {
    layeredControlRowIds?: ReadonlySet<number>
  } = {},
) {
  const reasons = new Set<string>()
  for (const row of rows) {
    for (const methodCode of methodCodes) {
      for (const reason of getLnkResultRestrictionReasons(row, methodCode, result, {
        ...options,
        layeredControlSelected: options.layeredControlSelected || options.layeredControlRowIds?.has(row.id),
      })) reasons.add(reason)
    }
  }
  return [...reasons].join('\n') || undefined
}
