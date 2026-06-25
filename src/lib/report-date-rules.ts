import { formatDisplayDate } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldInput } from '@/lib/weld-fields'

export function getWeldDateOrderValue(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return 0
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return Number(`${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`)
  const longMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (longMatch) return Number(`${longMatch[3]}${longMatch[2]}${longMatch[1]}`)
  const shortMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{2})$/)
  if (shortMatch) return Number(`20${shortMatch[3]}${shortMatch[2]}${shortMatch[1]}`)
  return 0
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
