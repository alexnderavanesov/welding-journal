import { useEffect, useState } from 'react'

import {
  persistProjectSettingToRemote,
  persistProjectSettingToRemoteAndWait,
  PROJECT_SETTING_KEYS,
} from '@/lib/project-settings-remote'

export const CONTROL_PROCESS_SETTINGS_EVENT = 'control-process-settings-change'

const CONTROL_PROCESS_SETTINGS_STORAGE_KEY = 'welding-control-process-settings'
let cachedControlProcessSettingsRaw: string | null | undefined
let cachedControlProcessSettings: ControlProcessSettings | undefined

export type ControlProcessSettings = {
  layeredControlEnabled: boolean
  preHeatTreatmentLnkEnabled: boolean
  allowPrimaryLnkBeforePreviousStagesComplete: boolean
}

export const DEFAULT_CONTROL_PROCESS_SETTINGS: ControlProcessSettings = {
  layeredControlEnabled: true,
  preHeatTreatmentLnkEnabled: true,
  allowPrimaryLnkBeforePreviousStagesComplete: false,
}

export function useControlProcessSettings() {
  const [settings, setSettings] = useState<ControlProcessSettings>(() => loadControlProcessSettings())

  useEffect(() => {
    const syncSettings = () => setSettings(loadControlProcessSettings())
    window.addEventListener(CONTROL_PROCESS_SETTINGS_EVENT, syncSettings)
    window.addEventListener('storage', syncSettings)
    return () => {
      window.removeEventListener(CONTROL_PROCESS_SETTINGS_EVENT, syncSettings)
      window.removeEventListener('storage', syncSettings)
    }
  }, [])

  return settings
}

export function loadControlProcessSettings(): ControlProcessSettings {
  if (typeof window === 'undefined') return DEFAULT_CONTROL_PROCESS_SETTINGS

  try {
    const rawValue = window.localStorage.getItem(CONTROL_PROCESS_SETTINGS_STORAGE_KEY)
    if (!rawValue) return DEFAULT_CONTROL_PROCESS_SETTINGS
    if (rawValue === cachedControlProcessSettingsRaw && cachedControlProcessSettings) {
      return cachedControlProcessSettings
    }
    cachedControlProcessSettingsRaw = rawValue
    cachedControlProcessSettings = normalizeControlProcessSettings(JSON.parse(rawValue))
    return cachedControlProcessSettings
  } catch {
    return DEFAULT_CONTROL_PROCESS_SETTINGS
  }
}

export function saveControlProcessSettings(
  settings: ControlProcessSettings,
  options: { syncRemote?: boolean } = {},
) {
  if (typeof window === 'undefined') return
  const normalizedSettings = normalizeControlProcessSettings(settings)
  saveControlProcessSettingsLocally(normalizedSettings)
  if (options.syncRemote !== false) {
    persistProjectSettingToRemote(PROJECT_SETTING_KEYS.controlProcesses, normalizedSettings)
  }
}

export async function saveControlProcessSettingsAndWait(settings: ControlProcessSettings) {
  if (typeof window === 'undefined') return
  const normalizedSettings = normalizeControlProcessSettings(settings)

  // These settings can be rejected by server-side workflow guards. Keep the
  // current UI state until the authoritative project save has succeeded.
  await persistProjectSettingToRemoteAndWait(PROJECT_SETTING_KEYS.controlProcesses, normalizedSettings)
  saveControlProcessSettingsLocally(normalizedSettings)
}

export function applyRemoteControlProcessSettings(settings: unknown) {
  saveControlProcessSettingsLocally(normalizeControlProcessSettings(settings))
}

export function normalizeControlProcessSettings(value: unknown): ControlProcessSettings {
  const source = value && typeof value === 'object'
    ? value as Partial<Record<keyof ControlProcessSettings, unknown>>
    : {}
  const preHeatTreatmentLnkEnabled = source.preHeatTreatmentLnkEnabled !== false
  return {
    layeredControlEnabled: source.layeredControlEnabled !== false,
    preHeatTreatmentLnkEnabled,
    allowPrimaryLnkBeforePreviousStagesComplete:
      preHeatTreatmentLnkEnabled && source.allowPrimaryLnkBeforePreviousStagesComplete === true,
  }
}

function saveControlProcessSettingsLocally(settings: ControlProcessSettings) {
  if (typeof window === 'undefined') return
  const serializedSettings = JSON.stringify(settings)
  cachedControlProcessSettingsRaw = serializedSettings
  cachedControlProcessSettings = settings
  window.localStorage.setItem(CONTROL_PROCESS_SETTINGS_STORAGE_KEY, serializedSettings)
  window.dispatchEvent(new Event(CONTROL_PROCESS_SETTINGS_EVENT))
}
