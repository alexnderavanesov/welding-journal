import { useEffect, useState } from 'react'
import { persistProjectSettingToRemoteAndWait, PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import {
  DEFAULT_DISPATCHER_SETTINGS,
  DISPATCHER_SETTING_CODES,
  isDispatcherReminderSettingId,
  type DispatcherSettings,
} from '@/lib/dispatcher-settings'
import { getBusinessDateIso } from '@/lib/business-date'

export const DISPATCHER_BACKGROUND_SETTINGS_EVENT = 'dispatcher-background-settings-change'
export const DISPATCHER_BACKGROUND_REFRESH_ENABLED = false

const STORAGE_KEY = 'welding-dispatcher-background-settings'

export type DispatcherBackgroundSettings = {
  enabled: boolean
}

export const DEFAULT_DISPATCHER_BACKGROUND_SETTINGS: DispatcherBackgroundSettings = {
  enabled: false,
}

export function buildDisabledDispatcherSettings(current: DispatcherSettings): DispatcherSettings {
  return Object.fromEntries(
    Object.keys(DEFAULT_DISPATCHER_SETTINGS).map((rawId) => {
      const id = rawId as keyof DispatcherSettings
      return [id, isDispatcherReminderSettingId(id) ? false : current[id] === false]
    }),
  ) as DispatcherSettings
}

export function getEnabledDispatcherTaskCodes(current: DispatcherSettings) {
  return [...new Set(
    Object.entries(DISPATCHER_SETTING_CODES)
      .filter(([rawId]) => current[rawId as keyof DispatcherSettings] !== false)
      .map(([, code]) => code),
  )]
}

export function shouldRefreshDispatcherBackgroundIndex(
  computedAt: Date | null | undefined,
  options: { computedSourceRevision?: number; force?: boolean; now?: Date; sourceRevision?: number } = {},
) {
  if (options.force || !computedAt) return true
  if (
    typeof options.sourceRevision === 'number' &&
    typeof options.computedSourceRevision === 'number' &&
    options.computedSourceRevision !== options.sourceRevision
  ) return true
  return getBusinessDateIso(computedAt) !== getBusinessDateIso(options.now)
}

export function normalizeDispatcherBackgroundSettings(value: unknown): DispatcherBackgroundSettings {
  const source = typeof value === 'object' && value ? value as Partial<DispatcherBackgroundSettings> : {}
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_DISPATCHER_BACKGROUND_SETTINGS.enabled,
  }
}

export function loadDispatcherBackgroundSettings() {
  if (typeof window === 'undefined') return DEFAULT_DISPATCHER_BACKGROUND_SETTINGS
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored ? normalizeDispatcherBackgroundSettings(JSON.parse(stored)) : DEFAULT_DISPATCHER_BACKGROUND_SETTINGS
  } catch {
    return DEFAULT_DISPATCHER_BACKGROUND_SETTINGS
  }
}

export function saveDispatcherBackgroundSettings(
  settings: DispatcherBackgroundSettings,
  options: { syncRemote?: boolean } = {},
) {
  if (typeof window === 'undefined') return
  const normalized = normalizeDispatcherBackgroundSettings(settings)
  const applyLocal = () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    window.dispatchEvent(new Event(DISPATCHER_BACKGROUND_SETTINGS_EVENT))
  }
  if (options.syncRemote === false) return applyLocal()
  return persistProjectSettingToRemoteAndWait(
    PROJECT_SETTING_KEYS.dispatcherBackground,
    normalized,
  ).then(applyLocal)
}

export function applyRemoteDispatcherBackgroundSettings(value: unknown) {
  saveDispatcherBackgroundSettings(normalizeDispatcherBackgroundSettings(value), { syncRemote: false })
}

export function useDispatcherBackgroundSettings() {
  const [settings, setSettings] = useState(loadDispatcherBackgroundSettings)

  useEffect(() => {
    const sync = () => setSettings(loadDispatcherBackgroundSettings())
    window.addEventListener(DISPATCHER_BACKGROUND_SETTINGS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(DISPATCHER_BACKGROUND_SETTINGS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return settings
}
