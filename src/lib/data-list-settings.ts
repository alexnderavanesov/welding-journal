import { useEffect, useState } from 'react'

export const DATA_LIST_SETTINGS_EVENT = 'data-list-settings-change'

const DATA_LIST_SETTINGS_STORAGE_KEY = 'welding-data-list-settings'

export const DEFAULT_WELDING_TYPE_OPTIONS = ['РАД', 'РД'] as const
export const DEFAULT_CONNECTION_TYPE_OPTIONS = [] as const
export const DEFAULT_MATERIAL_GROUP_OPTIONS = [] as const

export type DataListSettings = {
  weldingTypes: string[]
  connectionTypes: string[]
  materialGroups: string[]
}

export const DEFAULT_DATA_LIST_SETTINGS: DataListSettings = {
  weldingTypes: [...DEFAULT_WELDING_TYPE_OPTIONS],
  connectionTypes: [...DEFAULT_CONNECTION_TYPE_OPTIONS],
  materialGroups: [...DEFAULT_MATERIAL_GROUP_OPTIONS],
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

export function saveDataListSettings(settings: DataListSettings) {
  if (typeof window === 'undefined') return
  const normalizedSettings = normalizeDataListSettings(settings)
  window.localStorage.setItem(DATA_LIST_SETTINGS_STORAGE_KEY, JSON.stringify(normalizedSettings))
  window.dispatchEvent(new Event(DATA_LIST_SETTINGS_EVENT))
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

  return {
    weldingTypes: weldingTypes.length > 0 ? weldingTypes : DEFAULT_DATA_LIST_SETTINGS.weldingTypes,
    connectionTypes,
    materialGroups,
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
