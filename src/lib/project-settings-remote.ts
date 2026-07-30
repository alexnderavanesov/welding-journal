export const PROJECT_SETTING_KEYS = {
  dataList: 'data-list',
  dispatcher: 'dispatcher',
  dispatcherReminders: 'dispatcher-reminders',
  other: 'other',
  requestConclusion: 'request-conclusion',
  saveCheck: 'save-check',
  systemIndex: 'system-index',
} as const

export type ProjectSettingKey = (typeof PROJECT_SETTING_KEYS)[keyof typeof PROJECT_SETTING_KEYS]

export const PROJECT_SETTING_REMOTE_PERSIST_EVENT = 'project-setting-remote-persist'

export type ProjectSettingRemotePersistDetail = {
  key: ProjectSettingKey
  value: unknown
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
