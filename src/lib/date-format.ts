export function formatDisplayDate(value: unknown) {
  const text = String(value ?? '').trim()
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return text
  return `${match[3]}.${match[2]}.${match[1]}`
}

export function formatDateInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatShortDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${pad(date.getFullYear() % 100)}`
}

export function formatLongDate(date: Date) {
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(validDate.getDate())}.${pad(validDate.getMonth() + 1)}.${validDate.getFullYear()}`
}

export function parseLongDateValue(value: string) {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  return match ? Number(`${match[3]}${match[2]}${match[1]}`) : 0
}

export function formatPstoDiagramDate(value: unknown) {
  const text = String(value ?? '').trim()
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1].slice(2)}`
  const shortMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{2})$/)
  if (shortMatch) return text
  const longMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (longMatch) return `${longMatch[1]}.${longMatch[2]}.${longMatch[3].slice(2)}`
  return null
}

export function formatPstoDiagramLongDate(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`
  const longMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (longMatch) return text
  const shortMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{2})$/)
  if (shortMatch) return `${shortMatch[1]}.${shortMatch[2]}.20${shortMatch[3]}`
  return null
}

export function formatPstoDiagramShortDateFromLong(value: string) {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  return match ? `${match[1]}.${match[2]}.${match[3].slice(2)}` : formatShortDate(new Date())
}
