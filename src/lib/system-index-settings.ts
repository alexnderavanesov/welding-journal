import { useEffect, useState } from 'react'

export const SYSTEM_INDEX_SETTINGS_EVENT = 'system-index-settings-change'

const SYSTEM_INDEX_SETTINGS_STORAGE_KEY = 'welding-system-index-settings'

export type SystemIndexKey = 'shopJoint' | 'fieldJoint' | 'repair' | 'cutout' | 'coil'
export type JointSystemSuffix = 'R' | 'W' | 'Y'
export type SystemIndexSettings = Record<SystemIndexKey, string>

export const DEFAULT_SYSTEM_INDEX_SETTINGS: SystemIndexSettings = {
  shopJoint: 'S',
  fieldJoint: 'F',
  repair: 'R',
  cutout: 'W',
  coil: 'Y',
}

const suffixToSettingKey: Record<JointSystemSuffix, SystemIndexKey> = {
  R: 'repair',
  W: 'cutout',
  Y: 'coil',
}

const settingKeyToSuffix: Partial<Record<SystemIndexKey, JointSystemSuffix>> = {
  repair: 'R',
  cutout: 'W',
  coil: 'Y',
}

export function useSystemIndexSettings() {
  const [settings, setSettings] = useState<SystemIndexSettings>(() => loadSystemIndexSettings())

  useEffect(() => {
    const syncSettings = () => setSettings(loadSystemIndexSettings())
    window.addEventListener(SYSTEM_INDEX_SETTINGS_EVENT, syncSettings)
    window.addEventListener('storage', syncSettings)
    return () => {
      window.removeEventListener(SYSTEM_INDEX_SETTINGS_EVENT, syncSettings)
      window.removeEventListener('storage', syncSettings)
    }
  }, [])

  return settings
}

export function loadSystemIndexSettings(): SystemIndexSettings {
  if (typeof window === 'undefined') return DEFAULT_SYSTEM_INDEX_SETTINGS

  try {
    const rawValue = window.localStorage.getItem(SYSTEM_INDEX_SETTINGS_STORAGE_KEY)
    if (!rawValue) return DEFAULT_SYSTEM_INDEX_SETTINGS
    return normalizeSystemIndexSettings(JSON.parse(rawValue))
  } catch {
    return DEFAULT_SYSTEM_INDEX_SETTINGS
  }
}

export function saveSystemIndexSettings(settings: SystemIndexSettings) {
  if (typeof window === 'undefined') return
  const normalizedSettings = normalizeSystemIndexSettings(settings)
  window.localStorage.setItem(SYSTEM_INDEX_SETTINGS_STORAGE_KEY, JSON.stringify(normalizedSettings))
  window.dispatchEvent(new Event(SYSTEM_INDEX_SETTINGS_EVENT))
}

export function normalizeSystemIndexSettings(value: unknown): SystemIndexSettings {
  const source = typeof value === 'object' && value ? (value as Partial<Record<SystemIndexKey, unknown>>) : {}
  const settings = {
    shopJoint: normalizeSystemIndexLetter(source.shopJoint, DEFAULT_SYSTEM_INDEX_SETTINGS.shopJoint),
    fieldJoint: normalizeSystemIndexLetter(source.fieldJoint, DEFAULT_SYSTEM_INDEX_SETTINGS.fieldJoint),
    repair: normalizeSystemIndexLetter(source.repair, DEFAULT_SYSTEM_INDEX_SETTINGS.repair),
    cutout: normalizeSystemIndexLetter(source.cutout, DEFAULT_SYSTEM_INDEX_SETTINGS.cutout),
    coil: normalizeSystemIndexLetter(source.coil, DEFAULT_SYSTEM_INDEX_SETTINGS.coil),
  }
  return getSystemIndexValidationError(settings) ? DEFAULT_SYSTEM_INDEX_SETTINGS : settings
}

export function normalizeSystemIndexLetter(value: unknown, fallback = '') {
  const letter = String(value ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1)
  return letter || fallback
}

export function getSystemIndexValidationError(settings: SystemIndexSettings) {
  const letters = Object.values(settings).map((letter) => letter.trim().toUpperCase())
  const empty = letters.some((letter) => !/^[A-Z]$/.test(letter))
  if (empty) return 'Для каждого системного индекса нужна одна латинская буква.'
  if (new Set(letters).size !== letters.length) return 'Буквы системных индексов не должны повторяться.'
  return null
}

export function getConfiguredJointChainSuffix(suffix: JointSystemSuffix, settings = loadSystemIndexSettings()) {
  return settings[suffixToSettingKey[suffix]]
}

export function getSemanticJointChainSuffix(letter: string, settings = loadSystemIndexSettings()): JointSystemSuffix | null {
  const normalizedLetter = normalizeSystemIndexLetter(letter)
  const entry = Object.entries(settings).find(([, value]) => value === normalizedLetter)
  if (!entry) return null
  return settingKeyToSuffix[entry[0] as SystemIndexKey] ?? null
}

export function getConfiguredBaseJointType(baseJoint: string, settings = loadSystemIndexSettings()): 's' | 'f' | null {
  const normalizedBase = String(baseJoint ?? '').trim().toUpperCase()
  if (normalizedBase.startsWith(settings.fieldJoint)) return 'f'
  if (normalizedBase.startsWith(settings.shopJoint)) return 's'
  return null
}

export function getSystemIndexSummaryText(settings = loadSystemIndexSettings()) {
  return `${settings.repair}/${settings.cutout}/${settings.coil}`
}

export function getSystemIndexPrefixText(settings = loadSystemIndexSettings()) {
  return `${settings.shopJoint} или ${settings.fieldJoint}`
}

export function getSystemIndexExampleText(settings = loadSystemIndexSettings()) {
  return `${settings.shopJoint}13 или ${settings.fieldJoint}5`
}

export function getSystemChainSegmentPattern(settings = loadSystemIndexSettings()) {
  return `[${escapeRegExp(settings.repair)}${escapeRegExp(settings.cutout)}${escapeRegExp(settings.coil)}]`
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
