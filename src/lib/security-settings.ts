import { useCallback, useEffect, useState } from 'react'
import {
  getRemoteSecuritySettings,
  saveRemoteSecuritySettings,
} from '@/server/security-functions'

export const SECURITY_SETTINGS_EVENT = 'security-settings-change'

const SECURITY_SETTINGS_STORAGE_KEY = 'welding-security-settings'
export const SERVER_SECURITY_PASSWORD_PLACEHOLDER = '__server__'

export type SecuritySettings = {
  entryPassword: string
  settingsPassword: string
  editPassword: string
  importReplacePassword: string
  documentGenerationPassword: string
  deletePassword: string
  requirePasswordOnEntry: boolean
  protectSettings: boolean
  protectEdit: boolean
  protectImportReplace: boolean
  protectDocumentGeneration: boolean
  protectDelete: boolean
}

export type SecurityScope = 'entry' | 'settings' | 'edit' | 'importReplace' | 'documentGeneration' | 'delete'

export type SecurityPublicSettings = Record<SecurityScope, boolean> & {
  configured: boolean
  configuredScopes: Record<SecurityScope, boolean>
}

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  entryPassword: '',
  settingsPassword: '',
  editPassword: '',
  importReplacePassword: '',
  documentGenerationPassword: '',
  deletePassword: '',
  requirePasswordOnEntry: false,
  protectSettings: false,
  protectEdit: false,
  protectImportReplace: false,
  protectDocumentGeneration: false,
  protectDelete: false,
}

export function useSecuritySettings() {
  const [settings, setSettings] = useState<SecuritySettings>(() => loadSecuritySettings())

  useEffect(() => {
    const syncSettings = () => setSettings(loadSecuritySettings())
    window.addEventListener(SECURITY_SETTINGS_EVENT, syncSettings)
    window.addEventListener('storage', syncSettings)
    return () => {
      window.removeEventListener(SECURITY_SETTINGS_EVENT, syncSettings)
      window.removeEventListener('storage', syncSettings)
    }
  }, [])

  return settings
}

export function useEffectiveSecuritySettingsState() {
  const localSettings = useSecuritySettings()
  const [remoteSettings, setRemoteSettings] = useState<SecurityPublicSettings | null>(null)
  const [resolved, setResolved] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const localSecurityConfiguration = serializeLocalSecurityConfiguration(localSettings)
  const retry = useCallback(() => setLoadAttempt((current) => current + 1), [])

  useEffect(() => {
    let active = true
    setResolved(false)
    setLoadError(null)
    void getRemoteSecuritySettings()
      .then(async (settings) => {
        const hasLocalProtection = hasMigratableLocalSecurityPasswords(localSettings)
        const resolvedSettings = !settings.configured && hasLocalProtection
          ? await saveRemoteSecuritySettings({ data: localSettings })
          : settings
        if (active) {
          saveSecuritySettings(toLocalSecuritySettings(resolvedSettings))
          setRemoteSettings(resolvedSettings)
          setResolved(true)
        }
      })
      .catch(() => {
        if (active) {
          setLoadError('Не удалось проверить доступ к системе. Проверьте соединение с базой данных и повторите попытку.')
        }
      })
    return () => {
      active = false
    }
  }, [loadAttempt, localSecurityConfiguration])

  return {
    settings: remoteSettings ? applyRemoteSecurityFlags(localSettings, remoteSettings) : localSettings,
    resolved,
    loadError,
    retry,
  }
}

export function serializeLocalSecurityConfiguration(settings: SecuritySettings) {
  return JSON.stringify(normalizeSecuritySettings(settings))
}

export function loadSecuritySettings(): SecuritySettings {
  if (typeof window === 'undefined') return DEFAULT_SECURITY_SETTINGS

  try {
    const rawValue = window.localStorage.getItem(SECURITY_SETTINGS_STORAGE_KEY)
    if (!rawValue) return DEFAULT_SECURITY_SETTINGS
    return normalizeSecuritySettings(JSON.parse(rawValue))
  } catch {
    return DEFAULT_SECURITY_SETTINGS
  }
}

export function saveSecuritySettings(settings: SecuritySettings) {
  if (typeof window === 'undefined') return
  const normalizedSettings = normalizeSecuritySettings(settings)
  const serialized = JSON.stringify(normalizedSettings)
  if (window.localStorage.getItem(SECURITY_SETTINGS_STORAGE_KEY) === serialized) return
  window.localStorage.setItem(SECURITY_SETTINGS_STORAGE_KEY, serialized)
  window.dispatchEvent(new Event(SECURITY_SETTINGS_EVENT))
}

export function clearSecuritySettings() {
  saveSecuritySettings(DEFAULT_SECURITY_SETTINGS)
}

export function verifySecurityPassword(settings: SecuritySettings, scope: SecurityScope, password: string) {
  const scopePassword = getSecurityScopePassword(settings, scope)
  return Boolean(scopePassword) && password === scopePassword
}

export function isSecurityScopeEnabled(settings: SecuritySettings, scope: SecurityScope) {
  const scopePassword = getSecurityScopePassword(settings, scope)
  if (!scopePassword) return false
  if (scope === 'entry') return settings.requirePasswordOnEntry
  if (scope === 'settings') return settings.protectSettings
  if (scope === 'edit') return settings.protectEdit
  if (scope === 'importReplace') return settings.protectImportReplace
  if (scope === 'documentGeneration') return settings.protectDocumentGeneration
  return settings.protectDelete
}

export function getSecurityScopePassword(settings: SecuritySettings, scope: SecurityScope) {
  if (scope === 'entry') return settings.entryPassword
  if (scope === 'settings') return settings.settingsPassword
  if (scope === 'edit') return settings.editPassword
  if (scope === 'importReplace') return settings.importReplacePassword
  if (scope === 'documentGeneration') return settings.documentGenerationPassword
  return settings.deletePassword
}

export function normalizeSecuritySettings(value: unknown): SecuritySettings {
  const source = typeof value === 'object' && value ? (value as Partial<Record<keyof SecuritySettings, unknown>>) : {}
  const legacySource = typeof value === 'object' && value ? (value as { password?: unknown; protectEditDelete?: unknown }) : {}
  const legacyPassword = typeof legacySource.password === 'string' ? legacySource.password : ''
  const entryPassword = typeof source.entryPassword === 'string' ? source.entryPassword : legacyPassword
  const settingsPassword = typeof source.settingsPassword === 'string' ? source.settingsPassword : legacyPassword
  const editPassword = typeof source.editPassword === 'string' ? source.editPassword : legacyPassword
  const importReplacePassword = typeof source.importReplacePassword === 'string' ? source.importReplacePassword : ''
  const documentGenerationPassword =
    typeof source.documentGenerationPassword === 'string' ? source.documentGenerationPassword : ''
  const deletePassword = typeof source.deletePassword === 'string' ? source.deletePassword : legacyPassword
  const legacyProtectEditDelete = legacySource.protectEditDelete === true
  return {
    entryPassword,
    settingsPassword,
    editPassword,
    importReplacePassword,
    documentGenerationPassword,
    deletePassword,
    requirePasswordOnEntry: entryPassword ? source.requirePasswordOnEntry === true : false,
    protectSettings: settingsPassword ? source.protectSettings === true : false,
    protectEdit: editPassword ? source.protectEdit === true || legacyProtectEditDelete : false,
    protectImportReplace: importReplacePassword ? source.protectImportReplace === true : false,
    protectDocumentGeneration: documentGenerationPassword ? source.protectDocumentGeneration === true : false,
    protectDelete: deletePassword ? source.protectDelete === true || legacyProtectEditDelete : false,
  }
}

function applyRemoteSecurityFlags(
  settings: SecuritySettings,
  remote: SecurityPublicSettings,
): SecuritySettings {
  if (!remote.configured) return settings
  return {
    ...settings,
    ...toLocalSecuritySettings(remote),
  }
}

export function toLocalSecuritySettings(remote: SecurityPublicSettings): SecuritySettings {
  const password = (scope: SecurityScope) =>
    remote.configuredScopes[scope] ? SERVER_SECURITY_PASSWORD_PLACEHOLDER : ''
  return {
    entryPassword: password('entry'),
    settingsPassword: password('settings'),
    editPassword: password('edit'),
    importReplacePassword: password('importReplace'),
    documentGenerationPassword: password('documentGeneration'),
    deletePassword: password('delete'),
    requirePasswordOnEntry: remote.entry,
    protectSettings: remote.settings,
    protectEdit: remote.edit,
    protectImportReplace: remote.importReplace,
    protectDocumentGeneration: remote.documentGeneration,
    protectDelete: remote.delete,
  }
}

export function hasMigratableLocalSecurityPasswords(settings: SecuritySettings) {
  return [
    settings.entryPassword,
    settings.settingsPassword,
    settings.editPassword,
    settings.importReplacePassword,
    settings.documentGenerationPassword,
    settings.deletePassword,
  ].some((password) => Boolean(password) && password !== SERVER_SECURITY_PASSWORD_PLACEHOLDER)
}
