import { useEffect, useState } from 'react'
import { formatLongDate, formatPstoDiagramLongDate, formatPstoDiagramShortDateFromLong, formatShortDate } from '@/lib/date-format'
import {
  persistProjectSettingToRemoteAndWait,
  PROJECT_SETTING_KEYS,
} from '@/lib/project-settings-remote'
import type { RequestNamingState } from '@/lib/request-naming-state'

export const REQUEST_CONCLUSION_SETTINGS_EVENT = 'request-conclusion-settings-change'

const REQUEST_CONCLUSION_SETTINGS_STORAGE_KEY = 'welding-request-conclusion-settings'

export type RequestConclusionNamingKind = 'lnkRequest' | 'lnkConclusion' | 'pstoRequest' | 'pstoConclusion'

export type RequestConclusionNamingItemSettings = {
  defaultMode: RequestNamingState['mode']
  systemPattern: string
  systemPatternHistory?: string[]
}

export type RequestNamingPatternField =
  | 'date'
  | 'shortDate'
  | 'method'
  | 'number'
  | 'projectTitle'
  | 'subtitleCode'
  | 'line'

export type RequestNamingPatternPart =
  | { type: 'field'; field: RequestNamingPatternField }
  | { type: 'text'; value: string }

export const REQUEST_NAMING_PATTERN_FIELDS: Array<{
  id: RequestNamingPatternField
  label: string
  token: string
}> = [
  { id: 'date', label: 'Дата', token: 'Дата' },
  { id: 'shortDate', label: 'Дата короткая', token: 'ДатаКороткая' },
  { id: 'method', label: 'Метод', token: 'Метод' },
  { id: 'number', label: 'Порядковый номер', token: '№' },
  { id: 'projectTitle', label: 'Проект', token: 'Проект' },
  { id: 'subtitleCode', label: 'Шифр', token: 'Шифр' },
  { id: 'line', label: 'Линия', token: 'Линия' },
]

export type RequestConclusionSettings = Record<RequestConclusionNamingKind, RequestConclusionNamingItemSettings>

export const REQUEST_CONCLUSION_DEFAULT_SETTINGS: RequestConclusionSettings = {
  lnkRequest: {
    defaultMode: 'system',
    systemPattern: 'Заявка-{{Дата}}-{{№}}',
  },
  lnkConclusion: {
    defaultMode: 'system',
    systemPattern: 'Заключение-{{Метод}}-{{Дата}}-{{№}}',
  },
  pstoRequest: {
    defaultMode: 'system',
    systemPattern: 'ПСТО-{{ДатаКороткая}}-{{№}}',
  },
  pstoConclusion: {
    defaultMode: 'system',
    systemPattern: 'ПСТО-Д-{{ДатаКороткая}}-{{№}}',
  },
}

export type NamingPatternContext = {
  date: Date
  methodCode?: string
  shortDate?: string
  projectTitle?: string
  subtitleCode?: string
  line?: string
}

type NamingPatternRow = {
  projectTitle?: unknown
  subtitleCode?: unknown
  line?: unknown
}

export function addRowsToNamingPatternContext(
  context: NamingPatternContext,
  rows: NamingPatternRow[],
): NamingPatternContext {
  return {
    ...context,
    projectTitle: collectNamingValues(rows, 'projectTitle'),
    subtitleCode: collectNamingValues(rows, 'subtitleCode'),
    line: collectNamingValues(rows, 'line'),
  }
}

export function useRequestConclusionSettings() {
  const [settings, setSettings] = useState<RequestConclusionSettings>(() => loadRequestConclusionSettings())

  useEffect(() => {
    const syncSettings = () => setSettings(loadRequestConclusionSettings())
    window.addEventListener(REQUEST_CONCLUSION_SETTINGS_EVENT, syncSettings)
    window.addEventListener('storage', syncSettings)
    return () => {
      window.removeEventListener(REQUEST_CONCLUSION_SETTINGS_EVENT, syncSettings)
      window.removeEventListener('storage', syncSettings)
    }
  }, [])

  return settings
}

export function loadRequestConclusionSettings(): RequestConclusionSettings {
  if (typeof window === 'undefined') return REQUEST_CONCLUSION_DEFAULT_SETTINGS

  try {
    const rawValue = window.localStorage.getItem(REQUEST_CONCLUSION_SETTINGS_STORAGE_KEY)
    if (!rawValue) return REQUEST_CONCLUSION_DEFAULT_SETTINGS
    return normalizeRequestConclusionSettings(JSON.parse(rawValue))
  } catch {
    return REQUEST_CONCLUSION_DEFAULT_SETTINGS
  }
}

export function saveRequestConclusionSettings(settings: RequestConclusionSettings, options: { syncRemote?: boolean } = {}) {
  if (typeof window === 'undefined') return
  const normalizedSettings = rememberPreviousSystemPatterns(
    loadRequestConclusionSettings(),
    normalizeRequestConclusionSettings(settings),
  )
  const applyLocal = () => {
    window.localStorage.setItem(REQUEST_CONCLUSION_SETTINGS_STORAGE_KEY, JSON.stringify(normalizedSettings))
    window.dispatchEvent(new Event(REQUEST_CONCLUSION_SETTINGS_EVENT))
  }
  if (options.syncRemote === false) return applyLocal()
  return persistProjectSettingToRemoteAndWait(
    PROJECT_SETTING_KEYS.requestConclusion,
    normalizedSettings,
  ).then(applyLocal)
}

export function applyRemoteRequestConclusionSettings(settings: unknown) {
  const normalizedSettings = normalizeRequestConclusionSettings(settings)
  if (typeof window === 'undefined') return
  window.localStorage.setItem(REQUEST_CONCLUSION_SETTINGS_STORAGE_KEY, JSON.stringify(normalizedSettings))
  window.dispatchEvent(new Event(REQUEST_CONCLUSION_SETTINGS_EVENT))
}

export function getDefaultNamingState(settings: RequestConclusionSettings, kind: RequestConclusionNamingKind): RequestNamingState {
  return {
    mode: settings[kind].defaultMode,
    customName: '',
  }
}

export function buildSystemNameFromPattern(pattern: string, context: NamingPatternContext, existingNames: string[]) {
  const normalizedPattern = pattern.trim() || '{{Дата}}-{{№}}'
  const existingNameSet = new Set(existingNames.map((name) => name.trim()).filter(Boolean))
  const hasNumberToken = hasPatternToken(normalizedPattern, ['№', 'Номер'])

  if (!hasNumberToken) return renderNamingPattern(normalizedPattern, context, 1)

  for (let number = 1; number <= 9999; number += 1) {
    const name = renderNamingPattern(normalizedPattern, context, number)
    if (!existingNameSet.has(name)) return name
  }

  return renderNamingPattern(normalizedPattern, context, 10_000)
}

export function buildSystemNameWithNumber(
  pattern: string,
  context: NamingPatternContext,
  number: number,
) {
  const normalizedPattern = pattern.trim() || '{{Дата}}-{{№}}'
  return renderNamingPattern(normalizedPattern, context, Math.max(1, Math.floor(number)))
}

export function hasSystemDocumentNumberField(pattern: string) {
  return hasPatternToken(pattern, ['№', 'Номер'])
}

export function extractSystemNameNumber(
  pattern: string,
  context: NamingPatternContext,
  name: string,
) {
  const normalizedPattern = pattern.trim() || '{{Дата}}-{{№}}'
  if (!hasPatternToken(normalizedPattern, ['№', 'Номер'])) return ''

  const marker = '__SYSTEM_DOCUMENT_NUMBER__'
  const valueMarkers = {
    projectTitle: '__SYSTEM_DOCUMENT_PROJECT__',
    subtitleCode: '__SYSTEM_DOCUMENT_SUBTITLE__',
    line: '__SYSTEM_DOCUMENT_LINE__',
  }
  const renderedPattern = renderNamingPatternWithNumberText(
    normalizedPattern,
    {
      ...context,
      projectTitle: context.projectTitle ?? valueMarkers.projectTitle,
      subtitleCode: context.subtitleCode ?? valueMarkers.subtitleCode,
      line: context.line ?? valueMarkers.line,
    },
    marker,
  )
  const escapedMarker = escapeRegExp(marker)
  let numberPattern = escapeRegExp(renderedPattern)
    .split(escapedMarker)
    .join('(\\d+)')
  for (const valueMarker of Object.values(valueMarkers)) {
    numberPattern = numberPattern.split(escapeRegExp(valueMarker)).join('.*?')
  }
  const match = name.trim().match(new RegExp(`^${numberPattern}$`, 'u'))
  return match?.[1] ?? ''
}

export function parseRequestNamingPattern(pattern: string): RequestNamingPatternPart[] {
  const parts: RequestNamingPatternPart[] = []
  const tokenPattern = /\{\{\s*([^{}]+?)\s*\}\}/g
  let cursor = 0

  for (const match of pattern.matchAll(tokenPattern)) {
    const matchIndex = match.index ?? cursor
    appendTextPart(parts, pattern.slice(cursor, matchIndex))

    const field = getPatternFieldByToken(match[1])
    if (field) {
      parts.push({ type: 'field', field })
    } else {
      appendTextPart(parts, match[0])
    }
    cursor = matchIndex + match[0].length
  }

  appendTextPart(parts, pattern.slice(cursor))
  return parts
}

export function serializeRequestNamingPattern(parts: RequestNamingPatternPart[]) {
  return parts
    .map((part) => {
      if (part.type === 'text') return part.value
      const field = REQUEST_NAMING_PATTERN_FIELDS.find((item) => item.id === part.field)
      return field ? `{{${field.token}}}` : ''
    })
    .join('')
}

export function normalizeRequestConclusionSettings(value: unknown): RequestConclusionSettings {
  const source = typeof value === 'object' && value ? (value as Partial<Record<RequestConclusionNamingKind, Partial<RequestConclusionNamingItemSettings>>>) : {}

  return {
    lnkRequest: normalizeSettingsItem(source.lnkRequest, REQUEST_CONCLUSION_DEFAULT_SETTINGS.lnkRequest),
    lnkConclusion: normalizeSettingsItem(source.lnkConclusion, REQUEST_CONCLUSION_DEFAULT_SETTINGS.lnkConclusion),
    pstoRequest: normalizeSettingsItem(source.pstoRequest, REQUEST_CONCLUSION_DEFAULT_SETTINGS.pstoRequest),
    pstoConclusion: normalizeSettingsItem(source.pstoConclusion, REQUEST_CONCLUSION_DEFAULT_SETTINGS.pstoConclusion),
  }
}

function normalizeSettingsItem(
  value: Partial<RequestConclusionNamingItemSettings> | undefined,
  fallback: RequestConclusionNamingItemSettings,
): RequestConclusionNamingItemSettings {
  const defaultMode = value?.defaultMode === 'custom' ? 'custom' : 'system'
  const systemPattern = String(value?.systemPattern ?? '').trim() || fallback.systemPattern
  const systemPatternHistory = Array.from(
    new Set(
      (Array.isArray(value?.systemPatternHistory) ? value.systemPatternHistory : [])
        .map((pattern) => String(pattern ?? '').trim())
        .filter((pattern) => pattern && pattern !== systemPattern),
    ),
  ).slice(0, 20)
  return { defaultMode, systemPattern, systemPatternHistory }
}

function rememberPreviousSystemPatterns(
  previous: RequestConclusionSettings,
  next: RequestConclusionSettings,
): RequestConclusionSettings {
  return Object.fromEntries(
    (Object.keys(next) as RequestConclusionNamingKind[]).map((kind) => {
      const previousItem = previous[kind]
      const nextItem = next[kind]
      const history = Array.from(
        new Set([
          ...(previousItem.systemPattern !== nextItem.systemPattern
            ? [previousItem.systemPattern]
            : []),
          ...(nextItem.systemPatternHistory ?? []),
          ...(previousItem.systemPatternHistory ?? []),
        ]),
      )
        .map((pattern) => pattern.trim())
        .filter((pattern) => pattern && pattern !== nextItem.systemPattern)
        .slice(0, 20)
      return [kind, { ...nextItem, systemPatternHistory: history }]
    }),
  ) as RequestConclusionSettings
}

function appendTextPart(parts: RequestNamingPatternPart[], value: string) {
  if (!value) return
  const previousPart = parts.at(-1)
  if (previousPart?.type === 'text') {
    previousPart.value += value
    return
  }
  parts.push({ type: 'text', value })
}

function getPatternFieldByToken(token: string): RequestNamingPatternField | null {
  const normalizedToken = token.trim().toLowerCase()
  if (normalizedToken === 'дата') return 'date'
  if (normalizedToken === 'датакороткая' || normalizedToken === 'короткая дата') return 'shortDate'
  if (normalizedToken === 'метод') return 'method'
  if (normalizedToken === '№' || normalizedToken === 'номер') return 'number'
  if (normalizedToken === 'проект') return 'projectTitle'
  if (normalizedToken === 'шифр') return 'subtitleCode'
  if (normalizedToken === 'линия') return 'line'
  return null
}

function renderNamingPattern(pattern: string, context: NamingPatternContext, number: number) {
  return renderNamingPatternWithNumberText(pattern, context, String(number).padStart(3, '0'))
}

function renderNamingPatternWithNumberText(
  pattern: string,
  context: NamingPatternContext,
  numberText: string,
) {
  const longDate = formatLongDate(context.date)
  const shortDate = context.shortDate ?? formatShortDate(context.date)

  return pattern.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, token: string) => {
    const normalizedToken = token.trim().toLowerCase()
    if (normalizedToken === 'дата') return longDate
    if (normalizedToken === 'датакороткая' || normalizedToken === 'короткая дата') return shortDate
    if (normalizedToken === 'метод') return context.methodCode ?? ''
    if (normalizedToken === '№' || normalizedToken === 'номер') return numberText
    if (normalizedToken === 'проект') return context.projectTitle ?? ''
    if (normalizedToken === 'шифр') return context.subtitleCode ?? ''
    if (normalizedToken === 'линия') return context.line ?? ''
    return ''
  })
}

function collectNamingValues(rows: NamingPatternRow[], key: keyof NamingPatternRow) {
  return Array.from(new Set(rows.map((row) => String(row[key] ?? '').trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, 'ru', { numeric: true, sensitivity: 'base' }))
    .join(', ')
}

function hasPatternToken(pattern: string, tokens: string[]) {
  return tokens.some((token) => new RegExp(`\\{\\{\\s*${escapeRegExp(token)}\\s*\\}\\}`, 'i').test(pattern))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function getPstoConclusionDateParts(value: unknown) {
  const longDate = formatPstoDiagramLongDate(value) ?? formatLongDate(new Date())
  const date = parseLongDisplayDate(longDate) ?? new Date()
  return {
    date,
    shortDate: formatPstoDiagramShortDateFromLong(longDate),
  }
}

function parseLongDisplayDate(value: string) {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!match) return null
  return new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00`)
}
