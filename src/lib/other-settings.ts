import { useEffect, useState } from 'react'

export const OTHER_SETTINGS_EVENT = 'other-settings-change'

const OTHER_SETTINGS_STORAGE_KEY = 'welding-other-settings'

export type OtherSettings = {
  includeArchivedWelderStampsInForm: boolean
}

export const DEFAULT_OTHER_SETTINGS: OtherSettings = {
  includeArchivedWelderStampsInForm: false,
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

export function saveOtherSettings(settings: OtherSettings) {
  if (typeof window === 'undefined') return
  const normalizedSettings = normalizeOtherSettings(settings)
  window.localStorage.setItem(OTHER_SETTINGS_STORAGE_KEY, JSON.stringify(normalizedSettings))
  window.dispatchEvent(new Event(OTHER_SETTINGS_EVENT))
}

export function normalizeOtherSettings(value: unknown): OtherSettings {
  const source = typeof value === 'object' && value ? (value as Partial<Record<keyof OtherSettings, unknown>>) : {}
  return {
    includeArchivedWelderStampsInForm: source.includeArchivedWelderStampsInForm === true,
  }
}
