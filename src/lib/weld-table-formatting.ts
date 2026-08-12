import { BUSINESS_TIME_ZONE } from '@/lib/business-date'

export function formatDate(value: unknown) {
  if (!value) return ''
  const text = String(value)
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[3]}.${match[2]}.${match[1]}`
  return text
}

export function formatDateTime(value: unknown) {
  return formatDateTimeParts(value, false)
}

export function formatDateTimeWithSeconds(value: unknown) {
  return formatDateTimeParts(value, true)
}

function formatDateTimeParts(value: unknown, includeSeconds: boolean) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('ru-RU', {
      timeZone: BUSINESS_TIME_ZONE,
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      ...(includeSeconds ? { second: '2-digit' } : {}),
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  const time = includeSeconds
    ? `${parts.hour}:${parts.minute}:${parts.second}`
    : `${parts.hour}:${parts.minute}`
  return `${parts.day}.${parts.month}.${parts.year} ${time}`
}
