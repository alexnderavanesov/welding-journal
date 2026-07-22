import { WELDER_STAMP_FIELD_KEYS_FOR_DISPLAY as welderStampFieldKeysForDisplay } from '@/lib/report-config'
import { loadDataListSettings } from '@/lib/data-list-settings'
import { escapeRegExp } from '@/lib/string-utils'
import type { WelderStampExpiryTask } from '@/lib/dispatcher-types'
import { FIELD_BY_KEY, type WeldFieldKey } from '@/lib/weld-fields'
import { getWelderStampDlsPermits } from '@/lib/welder-stamp-permits'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export function splitWelderStampWeldTypes(value: string, options: readonly string[] = loadDataListSettings().weldingTypes) {
  const normalized = String(value ?? '').toUpperCase().replace(/;/g, ',')
  return options.filter((option) =>
    normalized
      .split(',')
      .map((item) => item.trim())
      .includes(option),
  )
}

export function normalizeWelderStampWeldType(value: string, options: readonly string[] = loadDataListSettings().weldingTypes) {
  return splitWelderStampWeldTypes(value, options).join(', ')
}

export function splitWelderStampMaterialGroups(
  value: string,
  options: readonly string[] = loadDataListSettings().materialGroups,
) {
  const normalized = String(value ?? '').toUpperCase().replace(/;/g, ',')
  return options.filter((option) =>
    normalized
      .split(',')
      .map((item) => item.trim())
      .includes(option),
  )
}

export function normalizeWelderStampMaterialGroups(
  value: string,
  options: readonly string[] = loadDataListSettings().materialGroups,
) {
  return splitWelderStampMaterialGroups(value, options).join(', ')
}

export function formatWelderStampDiameterRange(record: WelderStampRecord) {
  const from = record.diameterFrom.trim()
  const to = record.diameterTo.trim()

  if (from && to) return `${from} - ${to}`
  if (from) return `от ${from}`
  if (to) return `до ${to}`
  return '-'
}

export function formatWelderStampThicknessRange(record: WelderStampRecord) {
  const from = record.thicknessFrom.trim()
  const to = record.thicknessTo.trim()

  if (from && to) return `${from} - ${to}`
  if (from) return `от ${from}`
  if (to) return `до ${to}`
  return '-'
}

export function formatWelderStampDlsSummary(record: WelderStampRecord) {
  const count = getWelderStampDlsPermits(record).length
  return count > 0 ? `${count} ДЛС` : '-'
}

export function formatWelderStampValidity(record: WelderStampRecord) {
  const from = formatWelderStampDate(record.validFrom)
  const to = formatWelderStampDate(record.validTo)

  if (from && to) return `${from} - ${to}`
  if (from) return `с ${from}`
  if (to) return `до ${to}`
  return '-'
}

export function formatWelderStampDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value
}

export function formatWelderStampRecordLabel(record: WelderStampRecord) {
  const naksStamp = record.naksStamp.trim() || '-'
  const weldType = normalizeWelderStampWeldType(record.weldType)
  const materialGroups = normalizeWelderStampMaterialGroups(record.materialGroups)
  const parts = [
    weldType ? `способ: ${weldType}` : '',
    materialGroups ? `группа материалов: ${materialGroups}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? `Клеймо ${naksStamp} (${parts.join('; ')})` : `Клеймо ${naksStamp}`
}

export function formatWelderStampTaskLabel(task: WelderStampExpiryTask) {
  const recordLabel = formatWelderStampRecordLabel(task.stamp)
  if (task.permitKind === 'dls') return `${recordLabel} · ДЛС ${task.permitNumber?.trim() || '-'}`
  if (task.permitNumber?.trim()) return `${recordLabel} · НАКС ${task.permitNumber.trim()}`
  return recordLabel
}

export function formatWelderStampCompactLabel(task: WelderStampExpiryTask) {
  return `Клеймо ${task.naksStamp.trim() || '-'}`
}

export function formatWelderStampFieldKeyLabel(fieldKey: WeldFieldKey) {
  return FIELD_BY_KEY.get(fieldKey)?.label ?? fieldKey
}

export function formatWelderStampFieldKeysInText(value: string) {
  return welderStampFieldKeysForDisplay.reduce((text, fieldKey) => {
    return text.replace(new RegExp(`\\b${escapeRegExp(fieldKey)}\\b`, 'g'), formatWelderStampFieldKeyLabel(fieldKey))
  }, value)
}
