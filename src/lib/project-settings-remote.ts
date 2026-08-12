export const PROJECT_SETTING_KEYS = {
  dataList: 'data-list',
  dispatcher: 'dispatcher',
  dispatcherBackground: 'dispatcher-background',
  dispatcherReminders: 'dispatcher-reminders',
  other: 'other',
  requestConclusion: 'request-conclusion',
  saveCheck: 'save-check',
  systemIndex: 'system-index',
} as const

export type ProjectSettingKey = (typeof PROJECT_SETTING_KEYS)[keyof typeof PROJECT_SETTING_KEYS]

export const PROJECT_SETTING_KEY_VALUES = Object.values(PROJECT_SETTING_KEYS)

export function isProjectSettingKey(value: unknown): value is ProjectSettingKey {
  return PROJECT_SETTING_KEY_VALUES.includes(value as ProjectSettingKey)
}

export function projectSettingAffectsDispatcherIndex(key: unknown) {
  return key === PROJECT_SETTING_KEYS.dataList ||
    key === PROJECT_SETTING_KEYS.dispatcher ||
    key === PROJECT_SETTING_KEYS.dispatcherReminders ||
    key === PROJECT_SETTING_KEYS.saveCheck ||
    key === PROJECT_SETTING_KEYS.systemIndex
}

export function projectSettingAffectsDerivedCalculations(key: unknown) {
  return key === PROJECT_SETTING_KEYS.other || key === PROJECT_SETTING_KEYS.systemIndex
}

export const PROJECT_SETTING_REMOTE_PERSIST_EVENT = 'project-setting-remote-persist'

export type ProjectSettingRemotePersistDetail = {
  key: ProjectSettingKey
  value: unknown
  resolve?: () => void
  reject?: (error: unknown) => void
}

export function shouldSyncProjectSettingsRemote() {
  if (typeof window === 'undefined') return false
  if (import.meta.env.MODE === 'test' || import.meta.env.VITEST) return false
  return true
}

export function persistProjectSettingToRemote(key: ProjectSettingKey, value: unknown) {
  if (!shouldSyncProjectSettingsRemote()) return
  window.dispatchEvent(new CustomEvent<ProjectSettingRemotePersistDetail>(PROJECT_SETTING_REMOTE_PERSIST_EVENT, {
    detail: { key, value },
  }))
}

export function persistProjectSettingToRemoteAndWait(key: ProjectSettingKey, value: unknown) {
  if (!shouldSyncProjectSettingsRemote()) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    window.dispatchEvent(new CustomEvent<ProjectSettingRemotePersistDetail>(PROJECT_SETTING_REMOTE_PERSIST_EVENT, {
      detail: { key, value, resolve, reject },
    }))
  })
}
