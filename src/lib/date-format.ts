export const MIN_ALLOWED_DATE_ISO = '2024-01-01'
export const MIN_ALLOWED_DATE_DISPLAY = '01.01.2024'
export const DATE_INPUT_FORMAT_HINT = 'ДД.ММ.ГГГГ или ДД.ММ.ГГ'

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

export function getTodayIsoDate() {
  return formatDateInputValue(new Date())
}

export function parseDateLikeToIso(value: unknown) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return formatDateInputValue(value)
  }

  const text = String(value ?? '').trim()
  if (!text || text === '-') return null

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) return buildIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))

  const displayMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)
  if (displayMatch) {
    const yearText = displayMatch[3]
    const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText)
    return buildIsoDate(year, Number(displayMatch[2]), Number(displayMatch[1]))
  }

  return null
}

export function normalizeDateLikeForStorage(value: unknown) {
  if (value instanceof Date) return parseDateLikeToIso(value)
  const text = String(value ?? '').trim()
  if (!text || text === '-') return null
  return parseDateLikeToIso(text) ?? text
}

export function getDateInputValidationReason(
  value: unknown,
  label = 'Дата',
  options: { disallowFuture?: boolean } = {},
) {
  const text = String(value ?? '').trim()
  if (!text || text === '-') return ''

  const isoDate = parseDateLikeToIso(text)
  if (!isoDate) return `${label}: укажите дату в формате ${DATE_INPUT_FORMAT_HINT}.`
  if (isoDate < MIN_ALLOWED_DATE_ISO) return `${label} не может быть раньше ${MIN_ALLOWED_DATE_DISPLAY}.`
  if (options.disallowFuture && isoDate > getTodayIsoDate()) return `${label} не может быть позже сегодняшней.`
  return ''
}

function buildIsoDate(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null

  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  const pad = (part: number) => String(part).padStart(2, '0')
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
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
