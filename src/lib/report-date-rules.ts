import { formatValidationMessage, type ValidationMessageFormatter } from './validation-message'
import { formatDisplayDate, parseDateLikeToIso } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldInput } from '@/lib/weld-fields'

export function getWeldDateOrderValue(value: unknown) {
  const isoDate = parseDateLikeToIso(value)
  return isoDate ? Number(isoDate.replaceAll('-', '')) : 0
}

export function isDateBeforeWeldDate(value: unknown, weldDate: unknown) {
  const dateValue = getWeldDateOrderValue(value)
  const weldDateValue = getWeldDateOrderValue(weldDate)
  return Boolean(dateValue && weldDateValue && dateValue < weldDateValue)
}

export function findFirstDateBeforeWeldDateIssue(rows: WeldRow[], eventDate: unknown, eventLabel: string) {
  const row = rows.find((candidate) => isDateBeforeWeldDate(eventDate, candidate.weldDate))
  return row ? formatDateBeforeWeldDateSaveReason(row, eventDate, eventLabel) : null
}

export function formatDateBeforeWeldDateSaveReason(row: WeldInput, eventDate: unknown, eventLabel: string, format?: ValidationMessageFormatter) {
  const joint = String(row.joint ?? '').trim() || '-'
  return formatValidationMessage({ fields: ['weldDate'], publicMessage: `Стык ${joint}: ${eventLabel} не может быть раньше даты сварки.`,
    message: `Стык ${joint}: ${eventLabel} (${formatDisplayDate(parseDateLikeToIso(eventDate))}) не может быть раньше даты сварки (${formatDisplayDate(parseDateLikeToIso(row.weldDate))}).` }, format)
}
