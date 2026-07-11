import { useEffect, useState } from 'react'

export const SECURITY_SETTINGS_EVENT = 'security-settings-change'

const SECURITY_SETTINGS_STORAGE_KEY = 'welding-security-settings'

export type SecuritySettings = {
  entryPassword: string
  settingsPassword: string
  editPassword: string
  deletePassword: string
  requirePasswordOnEntry: boolean
  protectSettings: boolean
  protectEdit: boolean
  protectDelete: boolean
}

export type SecurityScope = 'entry' | 'settings' | 'edit' | 'delete'

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  entryPassword: '',
  settingsPassword: '',
  editPassword: '',
  deletePassword: '',
  requirePasswordOnEntry: false,
  protectSettings: false,
  protectEdit: false,
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
  window.localStorage.setItem(SECURITY_SETTINGS_STORAGE_KEY, JSON.stringify(normalizedSettings))
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
  return settings.protectDelete
}

export function getSecurityScopePassword(settings: SecuritySettings, scope: SecurityScope) {
  if (scope === 'entry') return settings.entryPassword
  if (scope === 'settings') return settings.settingsPassword
  if (scope === 'edit') return settings.editPassword
  return settings.deletePassword
}

export function normalizeSecuritySettings(value: unknown): SecuritySettings {
  const source = typeof value === 'object' && value ? (value as Partial<Record<keyof SecuritySettings, unknown>>) : {}
  const legacySource = typeof value === 'object' && value ? (value as { password?: unknown; protectEditDelete?: unknown }) : {}
  const legacyPassword = typeof legacySource.password === 'string' ? legacySource.password : ''
  const entryPassword = typeof source.entryPassword === 'string' ? source.entryPassword : legacyPassword
  const settingsPassword = typeof source.settingsPassword === 'string' ? source.settingsPassword : legacyPassword
  const editPassword = typeof source.editPassword === 'string' ? source.editPassword : legacyPassword
  const deletePassword = typeof source.deletePassword === 'string' ? source.deletePassword : legacyPassword
  const legacyProtectEditDelete = legacySource.protectEditDelete === true
  return {
    entryPassword,
    settingsPassword,
    editPassword,
    deletePassword,
    requirePasswordOnEntry: entryPassword ? source.requirePasswordOnEntry === true : false,
    protectSettings: settingsPassword ? source.protectSettings === true : false,
    protectEdit: editPassword ? source.protectEdit === true || legacyProtectEditDelete : false,
    protectDelete: deletePassword ? source.protectDelete === true || legacyProtectEditDelete : false,
  }
}
