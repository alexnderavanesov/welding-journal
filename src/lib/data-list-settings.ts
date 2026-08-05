import { useEffect, useState } from 'react'
import { persistProjectSettingToRemote, PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'

export const DATA_LIST_SETTINGS_EVENT = 'data-list-settings-change'

const DATA_LIST_SETTINGS_STORAGE_KEY = 'welding-data-list-settings'

export const DEFAULT_WELDING_TYPE_OPTIONS = ['РАД', 'РД'] as const
export const DEFAULT_CONNECTION_TYPE_OPTIONS = [] as const
export const DEFAULT_MATERIAL_GROUP_OPTIONS = [] as const
export const DEFAULT_TEST_TYPE_OPTIONS = ['ГИ', 'ПИ'] as const

export type DataListSettings = {
  weldingTypes: string[]
  connectionTypes: string[]
  materialGroups: string[]
  testTypes: string[]
}

const CYRILLIC_NUMERIC_DATA_LIST_KEYS = new Set<keyof DataListSettings>([
  'weldingTypes',
  'connectionTypes',
  'materialGroups',
])

export const DEFAULT_DATA_LIST_SETTINGS: DataListSettings = {
  weldingTypes: [...DEFAULT_WELDING_TYPE_OPTIONS],
  connectionTypes: [...DEFAULT_CONNECTION_TYPE_OPTIONS],
  materialGroups: [...DEFAULT_MATERIAL_GROUP_OPTIONS],
  testTypes: [...DEFAULT_TEST_TYPE_OPTIONS],
}

export function useDataListSettings() {
  const [settings, setSettings] = useState<DataListSettings>(() => loadDataListSettings())

  useEffect(() => {
    const syncSettings = () => setSettings(loadDataListSettings())
    window.addEventListener(DATA_LIST_SETTINGS_EVENT, syncSettings)
    window.addEventListener('storage', syncSettings)
    return () => {
      window.removeEventListener(DATA_LIST_SETTINGS_EVENT, syncSettings)
      window.removeEventListener('storage', syncSettings)
    }
  }, [])

  return settings
}

export function loadDataListSettings(): DataListSettings {
  if (typeof window === 'undefined') return DEFAULT_DATA_LIST_SETTINGS

  try {
    const rawValue = window.localStorage.getItem(DATA_LIST_SETTINGS_STORAGE_KEY)
    if (!rawValue) return DEFAULT_DATA_LIST_SETTINGS
    return normalizeDataListSettings(JSON.parse(rawValue))
  } catch {
    return DEFAULT_DATA_LIST_SETTINGS
  }
}

export function saveDataListSettings(settings: DataListSettings, options: { syncRemote?: boolean } = {}) {
  if (typeof window === 'undefined') return
  const normalizedSettings = normalizeDataListSettings(settings)
  window.localStorage.setItem(DATA_LIST_SETTINGS_STORAGE_KEY, JSON.stringify(normalizedSettings))
  window.dispatchEvent(new Event(DATA_LIST_SETTINGS_EVENT))
  if (options.syncRemote !== false) persistProjectSettingToRemote(PROJECT_SETTING_KEYS.dataList, normalizedSettings)
}

export function applyRemoteDataListSettings(settings: unknown) {
  saveDataListSettings(normalizeDataListSettings(settings), { syncRemote: false })
}

export function normalizeDataListSettings(value: unknown): DataListSettings {
  const source = typeof value === 'object' && value ? (value as Partial<Record<keyof DataListSettings, unknown>>) : {}
  const weldingTypes = Array.isArray(source.weldingTypes)
    ? normalizeDataListOptions(source.weldingTypes)
    : DEFAULT_DATA_LIST_SETTINGS.weldingTypes
  const connectionTypes = Array.isArray(source.connectionTypes)
    ? normalizeDataListOptions(source.connectionTypes)
    : DEFAULT_DATA_LIST_SETTINGS.connectionTypes
  const materialGroups = Array.isArray(source.materialGroups)
    ? normalizeDataListOptions(source.materialGroups)
    : DEFAULT_DATA_LIST_SETTINGS.materialGroups
  const testTypes = Array.isArray(source.testTypes)
    ? normalizeDataListOptions(source.testTypes)
    : DEFAULT_DATA_LIST_SETTINGS.testTypes

  return {
    weldingTypes: weldingTypes.length > 0 ? weldingTypes : DEFAULT_DATA_LIST_SETTINGS.weldingTypes,
    connectionTypes,
    materialGroups,
    testTypes,
  }
}

export function normalizeDataListOptions(values: unknown[]) {
  const seen = new Set<string>()
  return values.reduce<string[]>((options, value) => {
    const option = normalizeDataListOption(value)
    if (!option || seen.has(option)) return options
    seen.add(option)
    options.push(option)
    return options
  }, [])
}

export function normalizeDataListOption(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}

export function getDataListOptionInputError(key: keyof DataListSettings, value: unknown) {
  if (!CYRILLIC_NUMERIC_DATA_LIST_KEYS.has(key)) return null

  const option = normalizeDataListOption(value)
  if (!option) return null
  if (/^[А-ЯЁ0-9 ]+$/u.test(option)) return null

  return 'Разрешены только кириллические буквы, цифры и пробелы. Латиница и другие символы недоступны.'
}
