import {
  formatLongDate,
  formatPstoDiagramLongDate,
  formatPstoDiagramShortDateFromLong,
  formatShortDate,
  parseLongDateValue,
} from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RequestNamingState } from '@/lib/request-naming-state'
import { LNK_METHODS, LNK_REQUEST_FIELD_KEYS as lnkRequestFieldKeys } from '@/lib/report-config'
import { compactSearchText, normalizeSearchText } from '@/lib/report-row-utils'
import { escapeRegExp } from '@/lib/string-utils'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export function formatPstoRequestName(rows: WeldRow[]) {
  const date = formatShortDate(new Date())
  const prefix = `ПСТО-${date}-`
  const requestNames = [
    ...new Set(
      rows
        .map((row) => String(row.pstoRequest ?? '').trim())
        .filter((requestName) => requestName.startsWith(prefix)),
    ),
  ]
  const maxNumber = requestNames.reduce((max, requestName) => {
    const match = requestName.match(new RegExp(`^${escapeRegExp(prefix)}(\\d{3})$`))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  const nextNumber = Math.max(maxNumber, requestNames.length) + 1
  return `${prefix}${String(nextNumber).padStart(3, '0')}`
}

export function formatLnkRequestName(rows: WeldRow[]) {
  const date = formatLongDate(new Date())
  const prefix = `Заявка-${date}-`
  const maxNumber = rows
    .flatMap((row) => LNK_METHODS.map((method) => String(row[method.requestKey] ?? '').trim()))
    .map((requestName) => parseLnkRequestName(requestName))
    .filter((parsed): parsed is { dateValue: number; number: number } => Boolean(parsed && parsed.dateValue === parseLongDateValue(date)))
    .reduce((max, parsed) => Math.max(max, parsed.number), 0)
  const requestNames = [
    ...new Set(
      rows
        .flatMap((row) => LNK_METHODS.map((method) => String(row[method.requestKey] ?? '').trim()))
        .filter((requestName) => parseLnkRequestName(requestName)?.dateValue === parseLongDateValue(date)),
    ),
  ]
  const nextNumber = Math.max(maxNumber, requestNames.length) + 1
  return `${prefix}${String(nextNumber).padStart(3, '0')}`
}

export function collectRequestNames(rows: WeldInput[], fieldKeys: readonly WeldFieldKey[]) {
  return [
    ...new Set(
      rows
        .flatMap((row) => fieldKeys.map((fieldKey) => String(row[fieldKey] ?? '').trim()))
        .filter((value) => value.length > 0),
    ),
  ].sort((left, right) => left.localeCompare(right, 'ru'))
}

export function withCurrentOption(options: string[], value: string) {
  const current = value.trim()
  if (!current || options.includes(current)) return options
  return [current, ...options]
}

export function filterRequestNamesBySearch(requestNames: string[], search: string) {
  const query = normalizeSearchText(search)
  const compactQuery = compactSearchText(query)
  if (!query) return requestNames
  return requestNames.filter((requestName) => {
    const normalized = normalizeSearchText(requestName)
    return normalized.includes(query) || compactSearchText(normalized).includes(compactQuery)
  })
}

export function getRequestNameFromNaming(naming: RequestNamingState, systemName: string) {
  return naming.mode === 'system' ? systemName.trim() : naming.customName.trim()
}

export function formatRequestCreatedMessage(requestName: string, count: number) {
  const trimmedName = requestName.trim()
  const subject = /^заявка(?:\b|-)/i.test(trimmedName) ? trimmedName : `Заявка ${trimmedName}`
  return `${subject} создана для стыков: ${count}`
}

export function formatPstoDiagramName(rows: WeldInput[], pstoDate: string) {
  const date = formatPstoDiagramLongDate(pstoDate) ?? formatLongDate(new Date())
  const prefix = `ПСТО-Д-${formatPstoDiagramShortDateFromLong(date)}-`
  const maxNumber = rows
    .map((row) => String(row.heatTreatmentDiagram ?? '').trim())
    .map((value) => value.match(new RegExp(`^${escapeRegExp(prefix)}(\\d{3})$`))?.[1])
    .reduce((max, value) => (value ? Math.max(max, Number(value)) : max), 0)
  return `${prefix}${String(maxNumber + 1).padStart(3, '0')}`
}

export function formatLnkConclusionName(rows: WeldInput[], controlDate: string, methodKey: WeldFieldKey | '') {
  const date = formatLongDate(controlDate ? new Date(`${controlDate}T00:00:00`) : new Date())
  const method = methodKey ? LNK_METHODS.find((item) => item.requestKey === methodKey) : null
  const methodCode = method?.code ?? 'ЛНК'
  const prefix = `Заключение-${methodCode}-${date}-`
  const maxNumber = rows
    .flatMap((row) => LNK_METHODS.map((method) => String(row[method.conclusionKey] ?? '').trim()))
    .map((value) => value.match(new RegExp(`^(?:(?:Закл\\.|Заключение)-)?[^-]+-${escapeRegExp(date)}-(\\d{3})$`))?.[1])
    .reduce((max, value) => (value ? Math.max(max, Number(value)) : max), 0)
  return `${prefix}${String(maxNumber + 1).padStart(3, '0')}`
}

export function collectLnkResultRequestNames(rows: WeldInput[]) {
  return sortLnkRequestNamesNewestFirst(collectRequestNames(rows, lnkRequestFieldKeys))
}

export function sortPstoRequestNamesNewestFirst(requestNames: string[]) {
  return [...requestNames].sort((left, right) => {
    const leftParsed = parsePstoRequestName(left)
    const rightParsed = parsePstoRequestName(right)
    if (leftParsed && rightParsed) {
      if (leftParsed.dateValue !== rightParsed.dateValue) return rightParsed.dateValue - leftParsed.dateValue
      if (leftParsed.number !== rightParsed.number) return rightParsed.number - leftParsed.number
      return right.localeCompare(left, 'ru', { numeric: true })
    }
    if (leftParsed) return -1
    if (rightParsed) return 1
    return right.localeCompare(left, 'ru', { numeric: true })
  })
}

export function sortLnkRequestNamesNewestFirst(requestNames: string[]) {
  return [...requestNames].sort((left, right) => {
    const leftParsed = parseLnkRequestName(left)
    const rightParsed = parseLnkRequestName(right)
    if (leftParsed && rightParsed) {
      if (leftParsed.dateValue !== rightParsed.dateValue) return rightParsed.dateValue - leftParsed.dateValue
      if (leftParsed.number !== rightParsed.number) return rightParsed.number - leftParsed.number
      return right.localeCompare(left, 'ru', { numeric: true })
    }
    if (leftParsed) return -1
    if (rightParsed) return 1
    return right.localeCompare(left, 'ru', { numeric: true })
  })
}

export function parseLnkRequestName(value: string) {
  const match = value.trim().match(/^(?:ЛНК|Заявка)-(\d{2})\.(\d{2})\.(\d{2}|\d{4})-(\d{3})$/)
  if (!match) return null
  const [, day, month, year, number] = match
  const fullYear = year.length === 2 ? `20${year}` : year
  return {
    dateValue: Number(`${fullYear}${month}${day}`),
    number: Number(number),
  }
}

export function parsePstoRequestName(value: string) {
  const match = value.trim().match(/^ПСТО-(\d{2})\.(\d{2})\.(\d{2})-(\d{3})$/)
  if (!match) return null
  const [, day, month, year, number] = match
  return {
    dateValue: Number(`20${year}${month}${day}`),
    number: Number(number),
  }
}
