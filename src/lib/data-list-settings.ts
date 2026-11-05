import { userStorage } from '@/lib/user-storage'
import { useEffect, useState } from 'react'
import { persistProjectSettingToRemote, persistProjectSettingToRemoteAndWait, PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'

export const DATA_LIST_SETTINGS_EVENT = 'data-list-settings-change'

const DATA_LIST_SETTINGS_STORAGE_KEY = 'welding-data-list-settings'

export const DEFAULT_WELDING_TYPE_OPTIONS = ['РАД', 'РД'] as const
export const DEFAULT_CONNECTION_TYPE_OPTIONS = ['С17', 'У19', 'Т', 'Т1', 'Т3', 'Т4Д'] as const
export const DEFAULT_MATERIAL_GROUP_OPTIONS = ['М01', 'М05', 'М11'] as const
export const DEFAULT_TEST_TYPE_OPTIONS = ['ГИ', 'ПИ'] as const

export type DataListSettings = {
  weldingTypes: string[]
  connectionTypes: string[]
  materialGroups: string[]
  testTypes: string[]
  /** Older settings implicitly included the formerly fixed connection codes. */
  connectionTypesVersion?: 1
}
type DataListOptionKey = 'weldingTypes' | 'connectionTypes' | 'materialGroups' | 'testTypes'

/** These codes are part of system rules, not removable project options. */
export const SYSTEM_DATA_LIST_OPTIONS: Readonly<Record<DataListOptionKey, readonly string[]>> = {
  weldingTypes: DEFAULT_WELDING_TYPE_OPTIONS,
  connectionTypes: [],
  materialGroups: DEFAULT_MATERIAL_GROUP_OPTIONS,
  testTypes: [],
}

export function isSystemDataListOption(key: DataListOptionKey, value: string) {
  return SYSTEM_DATA_LIST_OPTIONS[key].includes(normalizeDataListOption(value))
}

const CYRILLIC_NUMERIC_DATA_LIST_KEYS = new Set<DataListOptionKey>([
  'weldingTypes',
  'connectionTypes',
  'materialGroups',
])

export const DEFAULT_DATA_LIST_SETTINGS: DataListSettings = {
  connectionTypesVersion: 1,
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
    const rawValue = userStorage.getItem(DATA_LIST_SETTINGS_STORAGE_KEY)
    if (!rawValue) return DEFAULT_DATA_LIST_SETTINGS
    return normalizeDataListSettings(JSON.parse(rawValue))
  } catch {
    return DEFAULT_DATA_LIST_SETTINGS
  }
}

export function saveDataListSettings(settings: DataListSettings, options: { syncRemote?: boolean } = {}) {
  if (typeof window === 'undefined') return
  const normalizedSettings = normalizeDataListSettings({ ...settings, connectionTypesVersion: 1 })
  userStorage.setItem(DATA_LIST_SETTINGS_STORAGE_KEY, JSON.stringify(normalizedSettings))
  window.dispatchEvent(new Event(DATA_LIST_SETTINGS_EVENT))
  if (options.syncRemote !== false) persistProjectSettingToRemote(PROJECT_SETTING_KEYS.dataList, normalizedSettings)
}

export async function saveDataListSettingsAndWait(settings: DataListSettings) {
  const normalizedSettings = normalizeDataListSettings({ ...settings, connectionTypesVersion: 1 })
  await persistProjectSettingToRemoteAndWait(PROJECT_SETTING_KEYS.dataList, normalizedSettings)
  saveDataListSettings(normalizedSettings, { syncRemote: false })
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
    connectionTypesVersion: 1,
    weldingTypes: normalizeDataListOptions([...SYSTEM_DATA_LIST_OPTIONS.weldingTypes, ...weldingTypes]),
    // Preserve what older projects already displayed, without writing on read.
    // Once explicitly saved, even an empty connection list remains authoritative.
    connectionTypes: source.connectionTypesVersion === 1 ? connectionTypes
      : normalizeDataListOptions([...DEFAULT_CONNECTION_TYPE_OPTIONS, ...connectionTypes]),
    materialGroups: normalizeDataListOptions([...SYSTEM_DATA_LIST_OPTIONS.materialGroups, ...materialGroups]),
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

export function getDataListOptionInputError(key: DataListOptionKey, value: unknown) {
  if (!CYRILLIC_NUMERIC_DATA_LIST_KEYS.has(key)) return null

  const option = normalizeDataListOption(value)
  if (!option) return null
  if (!/^[А-ЯЁ0-9 ]+$/u.test(option)) {
    return 'Разрешены только кириллические буквы, цифры и пробелы. Латиница и другие символы недоступны.'
  }
  if (key === 'connectionTypes' && !/^[СУТ]/u.test(option)) {
    return 'Тип соединения должен начинаться с кириллической «С», «У» или «Т», например С2, У17 или Т4Д.'
  }
  if (key === 'materialGroups' && !option.startsWith('М')) {
    return 'Группа материалов должна начинаться с кириллической «М», например М02.'
  }
  return null
}

/** Validate additions against the locked stored list; never discard legacy values on read. */
export function prepareDataListSettingsChange(previousValue: unknown, nextValue: unknown): DataListSettings {
  const previous = normalizeDataListSettings(previousValue)
  const next = normalizeDataListSettings({ ...(typeof nextValue === 'object' && nextValue ? nextValue : {}), connectionTypesVersion: 1 })
  const labels: Record<DataListOptionKey, string> = {
    weldingTypes: 'Способ сварки', connectionTypes: 'Тип соединения',
    materialGroups: 'Группа материалов', testTypes: 'Вид испытаний',
  }
  const errors: string[] = []
  for (const key of Object.keys(labels) as DataListOptionKey[]) {
    const existing = new Set(previous[key])
    for (const option of next[key]) {
      if (existing.has(option)) continue
      const error = getDataListOptionInputError(key, option)
      if (error) errors.push(`${labels[key]} «${option}»: ${error}`)
    }
  }
  if (errors.length) throw new Error(errors.join('\n'))
  return next
}
