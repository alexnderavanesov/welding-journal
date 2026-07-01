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

export function formatDateBeforeWeldDateSaveReason(row: WeldInput, eventDate: unknown, eventLabel: string) {
  const joint = String(row.joint ?? '').trim() || '-'
  return `${eventLabel} не может быть раньше даты сварки: стык ${joint}, сварка ${formatDisplayDate(row.weldDate) || '-'}, дата ${formatDisplayDate(eventDate) || '-'}.`
}
