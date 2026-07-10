import type { WeldRow } from '@/lib/dispatcher-types'
import type { RequestNamingState } from '@/lib/request-naming-state'
import {
  REQUEST_CONCLUSION_DEFAULT_SETTINGS,
  buildSystemNameFromPattern,
  type RequestConclusionSettings,
} from '@/lib/request-conclusion-settings'
import { LNK_METHODS, LNK_REQUEST_FIELD_KEYS as lnkRequestFieldKeys } from '@/lib/report-config'
import { compactSearchText, normalizeSearchText } from '@/lib/report-row-utils'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export function formatPstoRequestName(rows: WeldRow[], settings: RequestConclusionSettings = REQUEST_CONCLUSION_DEFAULT_SETTINGS) {
  return buildSystemNameFromPattern(
    settings.pstoRequest.systemPattern,
    { date: new Date() },
    rows.map((row) => String(row.pstoRequest ?? '').trim()),
  )
}

export function formatLnkRequestName(rows: WeldRow[], settings: RequestConclusionSettings = REQUEST_CONCLUSION_DEFAULT_SETTINGS) {
  return buildSystemNameFromPattern(
    settings.lnkRequest.systemPattern,
    { date: new Date() },
    rows.flatMap((row) => LNK_METHODS.map((method) => String(row[method.requestKey] ?? '').trim())),
  )
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
