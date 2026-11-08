import { useEffect, useState } from 'react'
import { userStorage } from '@/lib/user-storage'
import { persistProjectSettingToRemoteAndWait, PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { normalizeAssignmentWarningSettings, validateAssignmentWarningSettings, type AssignmentWarningSettings } from '@/lib/assignment-warnings'

const STORAGE_KEY = 'welding-assignment-warnings'
const EVENT = 'assignment-warning-settings-change'

export function loadAssignmentWarningSettings() {
  try {
    return normalizeAssignmentWarningSettings(typeof window === 'undefined' ? null : JSON.parse(userStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch { return normalizeAssignmentWarningSettings(null) }
}

export function applyRemoteAssignmentWarningSettings(value: unknown) {
  if (typeof window === 'undefined') return
  userStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeAssignmentWarningSettings(value)))
  window.dispatchEvent(new Event(EVENT))
}

export async function saveAssignmentWarningSettings(value: AssignmentWarningSettings) {
  const settings = validateAssignmentWarningSettings(value)
  await persistProjectSettingToRemoteAndWait(PROJECT_SETTING_KEYS.assignmentWarnings, settings)
  applyRemoteAssignmentWarningSettings(settings)
}

export function useAssignmentWarningSettings() {
  const [settings, setSettings] = useState(loadAssignmentWarningSettings)
  useEffect(() => {
    const sync = () => setSettings(loadAssignmentWarningSettings())
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync) }
  }, [])
  return settings
}
