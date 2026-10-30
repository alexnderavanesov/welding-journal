import { userStorage } from '@/lib/user-storage'
import { useEffect, useState } from 'react'
import { loadOtherSettings } from '@/lib/other-settings'
import { persistProjectSettingToRemote, PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'

export const SAVE_CHECK_SETTINGS_EVENT = 'save-check-settings-change'

const SAVE_CHECK_SETTINGS_STORAGE_KEY = 'welding-save-check-settings'

export type SaveCheckSettingId =
  | 'officialRegistry'
  | 'officialNaksDate'
  | 'officialSuspension'
  | 'officialWeldingMethod'
  | 'officialMaterialGroup'
  | 'officialDiameter'
  | 'officialThickness'
  | 'officialDls'
  | 'requiredRootStampWithWeldDate'
  | 'requiredMaterialGroupWithWeldDate'
  | 'requiredConnectionTypeWithWeldDate'
  | 'requiredWeldingMethodWithWeldDate'
  | 'dateFormat'
  | 'weldDateNotFuture'
  | 'lnkResultControlDateRequired'
  | 'lnkResultControlDateFormat'
  | 'lnkResultDateAfterWeldDate'
  | 'lnkResultRequestDateOrder'
  | 'lnkResultVikDateBeforeOther'
  | 'lnkResultVikRequiredBeforeOther'
  | 'lnkResultConclusionRequired'
  | 'pstoResultDateRequired'
  | 'pstoResultDateFormat'
  | 'pstoResultDateAfterWeldDate'
  | 'pstoResultRequestDateOrder'
  | 'pstoResultDiagramRequired'
  | 'manualJointName'
  | 'controlHistoryProtection'
  | 'systemJointRenameProtection'

export type SaveCheckSettings = Record<SaveCheckSettingId, boolean>

export const OPTIONAL_SAVE_CHECK_SETTING_IDS: ReadonlySet<SaveCheckSettingId> = new Set(['manualJointName'])

// Incomplete welding metadata still creates SP-03. Document requisites are
// mandatory on new/corrected results independently of dispatcher diagnostics.
const COMPLETENESS_SAVE_SETTING_IDS: ReadonlySet<SaveCheckSettingId> = new Set([
  'requiredRootStampWithWeldDate', 'requiredMaterialGroupWithWeldDate',
  'requiredConnectionTypeWithWeldDate', 'requiredWeldingMethodWithWeldDate',
])

export const REQUIRED_SAVE_CHECK_SETTING_IDS: ReadonlySet<SaveCheckSettingId> = new Set([
  'lnkResultControlDateRequired', 'lnkResultConclusionRequired',
  'pstoResultDateRequired', 'pstoResultDiagramRequired',
  'officialRegistry', 'officialNaksDate', 'officialSuspension', 'officialWeldingMethod',
  'officialMaterialGroup', 'officialDiameter', 'officialThickness', 'dateFormat',
  'weldDateNotFuture', 'lnkResultControlDateFormat', 'lnkResultDateAfterWeldDate',
  'lnkResultRequestDateOrder', 'lnkResultVikDateBeforeOther', 'lnkResultVikRequiredBeforeOther',
  'pstoResultDateFormat', 'pstoResultDateAfterWeldDate', 'pstoResultRequestDateOrder',
  'controlHistoryProtection', 'systemJointRenameProtection',
])

export function isRequiredSaveCheckSetting(id: SaveCheckSettingId) {
  return REQUIRED_SAVE_CHECK_SETTING_IDS.has(id)
}

export type SaveCheckSettingItem = {
  id: SaveCheckSettingId
  label: string
  description: string
  example: string
}

export type SaveCheckSettingGroup = {
  id: string
  title: string
  description: string
  items: SaveCheckSettingItem[]
}

export const SAVE_CHECK_SETTING_CODES: Record<SaveCheckSettingId, string> = {
  officialRegistry: 'СП-02', officialNaksDate: 'СП-02',
  officialSuspension: 'СП-02', officialWeldingMethod: 'СП-02', officialMaterialGroup: 'СП-02',
  officialDiameter: 'СП-02', officialThickness: 'СП-02', officialDls: 'СП-02',
  requiredRootStampWithWeldDate: 'СП-03', requiredMaterialGroupWithWeldDate: 'СП-03',
  requiredConnectionTypeWithWeldDate: 'СП-03', requiredWeldingMethodWithWeldDate: 'СП-03',
  dateFormat: '', weldDateNotFuture: 'СП-04', lnkResultControlDateRequired: '',
  lnkResultControlDateFormat: '', lnkResultDateAfterWeldDate: 'СП-04',
  lnkResultRequestDateOrder: 'СП-04', lnkResultVikDateBeforeOther: 'СП-05',
  lnkResultVikRequiredBeforeOther: 'СП-05', lnkResultConclusionRequired: '',
  pstoResultDateRequired: '', pstoResultDateFormat: '',
  pstoResultDateAfterWeldDate: 'СП-04', pstoResultRequestDateOrder: 'СП-04',
  pstoResultDiagramRequired: '', manualJointName: 'ЗВ-01',
  controlHistoryProtection: 'СП-11', systemJointRenameProtection: 'СП-09',
}

const SAVE_CHECK_REASON_CODE_PATTERN = /^(?:ЗВ|СП)-\d+\s·\s/

export const SAVE_CHECK_SETTING_GROUPS: SaveCheckSettingGroup[] = [{
  id: 'optional-input', title: 'Защиты ввода',
  description: 'Организационные ограничения. Их отключение не отменяет обязательные системные правила.',
  items: [
    { id: 'manualJointName', label: 'Формат имени обычного стыка',
      description: 'Проверяет соответствие обычного имени настроенному шаблону. Отключение позволяет нумерацию заказчика, но не отменяет защиту реальных системных связей по СП-09.',
      example: 'ЗВ-01 можно выключить для нумерации заказчика. Ремонт и катушка по-прежнему создаются предусмотренным процессом.' },
  ],
}]
export const SAVE_CHECK_SETTING_ITEMS: SaveCheckSettingItem[] = SAVE_CHECK_SETTING_GROUPS.flatMap(group => group.items)

export const DEFAULT_SAVE_CHECK_SETTINGS: SaveCheckSettings = {
  officialRegistry: true,
  officialNaksDate: true,
  officialSuspension: true,
  officialWeldingMethod: true,
  officialMaterialGroup: true,
  officialDiameter: true,
  officialThickness: true,
  officialDls: false,
  requiredRootStampWithWeldDate: false,
  requiredMaterialGroupWithWeldDate: false,
  requiredConnectionTypeWithWeldDate: false,
  requiredWeldingMethodWithWeldDate: false,
  dateFormat: true,
  weldDateNotFuture: true,
  lnkResultControlDateRequired: true,
  lnkResultControlDateFormat: true,
  lnkResultDateAfterWeldDate: true,
  lnkResultRequestDateOrder: true,
  lnkResultVikDateBeforeOther: true,
  lnkResultVikRequiredBeforeOther: true,
  lnkResultConclusionRequired: true,
  pstoResultDateRequired: true,
  pstoResultDateFormat: true,
  pstoResultDateAfterWeldDate: true,
  pstoResultRequestDateOrder: true,
  pstoResultDiagramRequired: true,
  manualJointName: true,
  controlHistoryProtection: true,
  systemJointRenameProtection: true,
}

export function useSaveCheckSettings() {
  const [settings, setSettings] = useState<SaveCheckSettings>(() => loadSaveCheckSettings())

  useEffect(() => {
    const syncSettings = () => setSettings(loadSaveCheckSettings())
    window.addEventListener(SAVE_CHECK_SETTINGS_EVENT, syncSettings)
    window.addEventListener('storage', syncSettings)
    return () => {
      window.removeEventListener(SAVE_CHECK_SETTINGS_EVENT, syncSettings)
      window.removeEventListener('storage', syncSettings)
    }
  }, [])

  return settings
}

export function loadSaveCheckSettings(): SaveCheckSettings {
  if (typeof window === 'undefined') return DEFAULT_SAVE_CHECK_SETTINGS

  try {
    const rawValue = userStorage.getItem(SAVE_CHECK_SETTINGS_STORAGE_KEY)
    if (!rawValue) return { ...DEFAULT_SAVE_CHECK_SETTINGS, officialDls: loadOtherSettings().requireDlsForOfficialStamps }
    return normalizeSaveCheckSettings(JSON.parse(rawValue))
  } catch {
    return { ...DEFAULT_SAVE_CHECK_SETTINGS, officialDls: loadOtherSettings().requireDlsForOfficialStamps }
  }
}

export function saveSaveCheckSettings(settings: SaveCheckSettings, options: { syncRemote?: boolean } = {}) {
  if (typeof window === 'undefined') return
  const normalizedSettings = normalizeSaveCheckSettings(settings)
  userStorage.setItem(SAVE_CHECK_SETTINGS_STORAGE_KEY, JSON.stringify(normalizedSettings))
  window.dispatchEvent(new Event(SAVE_CHECK_SETTINGS_EVENT))
  if (options.syncRemote !== false) persistProjectSettingToRemote(PROJECT_SETTING_KEYS.saveCheck, normalizedSettings)
}

export function applyRemoteSaveCheckSettings(settings: unknown) {
  saveSaveCheckSettings(normalizeSaveCheckSettings(settings), { syncRemote: false })
}

export function normalizeSaveCheckSettings(
  value: unknown,
  options: { officialDlsFallback?: boolean } = {},
): SaveCheckSettings {
  const source = typeof value === 'object' && value ? (value as Partial<Record<SaveCheckSettingId, unknown>>) : {}
  return Object.fromEntries(
    Object.entries(DEFAULT_SAVE_CHECK_SETTINGS).map(([id, defaultValue]) => {
      const key = id as SaveCheckSettingId
      if (isRequiredSaveCheckSetting(key)) return [key, true]
      if (COMPLETENESS_SAVE_SETTING_IDS.has(key)) return [key, false]
      const fallback = key === 'officialDls'
        ? options.officialDlsFallback ?? loadOtherSettings().requireDlsForOfficialStamps
        : defaultValue
      return [key, typeof source[key] === 'boolean' ? source[key] : fallback]
    }),
  ) as SaveCheckSettings
}

export function getSaveCheckSettingCode(id: SaveCheckSettingId) {
  return SAVE_CHECK_SETTING_CODES[id]
}

export function formatSaveCheckBlockReason(id: SaveCheckSettingId, message: string) {
  if (!message) return message
  if (SAVE_CHECK_REASON_CODE_PATTERN.test(message)) return message
  const code = getSaveCheckSettingCode(id)
  return code ? `${code} · ${message}` : message
}
