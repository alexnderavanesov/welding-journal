import { useEffect, useState } from 'react'
import { persistProjectSettingToRemote, PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'

export const OTHER_SETTINGS_EVENT = 'other-settings-change'

const OTHER_SETTINGS_STORAGE_KEY = 'welding-other-settings'

export type WdiCalculationMode = 'manual' | 'formula' | 'table'

export type WdiTableSettings = {
  fileName: string
  uploadedAt: string
  diameters: number[]
  thicknesses: number[]
  values: Array<Array<number | null>>
}

export type OtherSettings = {
  requireDlsForOfficialStamps: boolean
  wdiCalculationMode: WdiCalculationMode
  wdiTable: WdiTableSettings | null
}

export const DEFAULT_OTHER_SETTINGS: OtherSettings = {
  requireDlsForOfficialStamps: false,
  wdiCalculationMode: 'manual',
  wdiTable: null,
}

export function useOtherSettings() {
  const [settings, setSettings] = useState<OtherSettings>(() => loadOtherSettings())

  useEffect(() => {
    const syncSettings = () => setSettings(loadOtherSettings())
    window.addEventListener(OTHER_SETTINGS_EVENT, syncSettings)
    window.addEventListener('storage', syncSettings)
    return () => {
      window.removeEventListener(OTHER_SETTINGS_EVENT, syncSettings)
      window.removeEventListener('storage', syncSettings)
    }
  }, [])

  return settings
}

export function loadOtherSettings(): OtherSettings {
  if (typeof window === 'undefined') return DEFAULT_OTHER_SETTINGS

  try {
    const rawValue = window.localStorage.getItem(OTHER_SETTINGS_STORAGE_KEY)
    if (!rawValue) return DEFAULT_OTHER_SETTINGS
    return normalizeOtherSettings(JSON.parse(rawValue))
  } catch {
    return DEFAULT_OTHER_SETTINGS
  }
}

export function saveOtherSettings(settings: OtherSettings, options: { syncRemote?: boolean } = {}) {
  if (typeof window === 'undefined') return
  const normalizedSettings = normalizeOtherSettings(settings)
  window.localStorage.setItem(OTHER_SETTINGS_STORAGE_KEY, JSON.stringify(normalizedSettings))
  window.dispatchEvent(new Event(OTHER_SETTINGS_EVENT))
  if (options.syncRemote !== false) persistProjectSettingToRemote(PROJECT_SETTING_KEYS.other, normalizedSettings)
}

export function applyRemoteOtherSettings(settings: unknown) {
  saveOtherSettings(normalizeOtherSettings(settings), { syncRemote: false })
}

export function normalizeOtherSettings(value: unknown): OtherSettings {
  const source = typeof value === 'object' && value ? (value as Partial<Record<keyof OtherSettings | 'wdiInputMode', unknown>>) : {}
  const legacyWdiInputMode = source.wdiInputMode === 'system' ? 'formula' : source.wdiInputMode === 'manual' ? 'manual' : null
  const wdiCalculationMode =
    source.wdiCalculationMode === 'formula' || source.wdiCalculationMode === 'table' || source.wdiCalculationMode === 'manual'
      ? source.wdiCalculationMode
      : legacyWdiInputMode ?? DEFAULT_OTHER_SETTINGS.wdiCalculationMode
  const wdiTable = normalizeWdiTableSettings(source.wdiTable)
  return {
    requireDlsForOfficialStamps: source.requireDlsForOfficialStamps === true,
    wdiCalculationMode: wdiCalculationMode === 'table' && !wdiTable ? 'manual' : wdiCalculationMode,
    wdiTable,
  }
}

function normalizeWdiTableSettings(value: unknown): WdiTableSettings | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<WdiTableSettings>
  const diameters = normalizeNumberArray(source.diameters)
  const thicknesses = normalizeNumberArray(source.thicknesses)
  const values = Array.isArray(source.values)
    ? source.values.map((row) => (Array.isArray(row) ? row.map((cell) => normalizeNullableNumber(cell)) : []))
    : []
  if (diameters.length === 0 || thicknesses.length === 0 || values.length === 0) return null
  return {
    fileName: typeof source.fileName === 'string' ? source.fileName : 'Таблица WDI',
    uploadedAt: typeof source.uploadedAt === 'string' ? source.uploadedAt : '',
    diameters,
    thicknesses,
    values,
  }
}

function normalizeNumberArray(values: unknown) {
  return Array.isArray(values)
    ? values.map((value) => normalizeNullableNumber(value)).filter((value): value is number => value !== null)
    : []
}

function normalizeNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(String(value).trim().replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}
