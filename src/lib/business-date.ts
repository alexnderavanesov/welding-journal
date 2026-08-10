export const BUSINESS_TIME_ZONE = 'Europe/Moscow'

const isoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function getBusinessDateIso(value: Date = new Date()) {
  const parts = Object.fromEntries(
    isoDateFormatter
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function formatBusinessDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('ru-RU', { timeZone: BUSINESS_TIME_ZONE })
}
