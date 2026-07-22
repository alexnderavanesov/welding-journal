import { useEffect, useState } from 'react'
import { formatLongDate, formatPstoDiagramLongDate, formatPstoDiagramShortDateFromLong, formatShortDate } from '@/lib/date-format'
import type { RequestNamingState } from '@/lib/request-naming-state'

export const REQUEST_CONCLUSION_SETTINGS_EVENT = 'request-conclusion-settings-change'

const REQUEST_CONCLUSION_SETTINGS_STORAGE_KEY = 'welding-request-conclusion-settings'

export type RequestConclusionNamingKind = 'lnkRequest' | 'lnkConclusion' | 'pstoRequest' | 'pstoConclusion'

export type RequestConclusionNamingItemSettings = {
  defaultMode: RequestNamingState['mode']
  systemPattern: string
}

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

type NamingPatternContext = {
  date: Date
  methodCode?: string
  shortDate?: string
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

export function saveRequestConclusionSettings(settings: RequestConclusionSettings) {
  if (typeof window === 'undefined') return
  const normalizedSettings = normalizeRequestConclusionSettings(settings)
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

function normalizeRequestConclusionSettings(value: unknown): RequestConclusionSettings {
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
  return { defaultMode, systemPattern }
}

function renderNamingPattern(pattern: string, context: NamingPatternContext, number: number) {
  const longDate = formatLongDate(context.date)
  const shortDate = context.shortDate ?? formatShortDate(context.date)
  const numberText = String(number).padStart(3, '0')

  return pattern.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, token: string) => {
    const normalizedToken = token.trim().toLowerCase()
    if (normalizedToken === 'дата') return longDate
    if (normalizedToken === 'датакороткая' || normalizedToken === 'короткая дата') return shortDate
    if (normalizedToken === 'метод') return context.methodCode ?? ''
    if (normalizedToken === '№' || normalizedToken === 'номер') return numberText
    return ''
  })
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
