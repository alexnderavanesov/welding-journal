import { WELDER_STAMP_WELD_TYPE_OPTIONS as welderStampWeldTypeOptions } from '@/lib/report-config'
import type { WelderStampExpiryTask } from '@/lib/dispatcher-types'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export function splitWelderStampWeldTypes(value: string) {
  const normalized = value.toUpperCase().replace(/;/g, ',')
  return welderStampWeldTypeOptions.filter((option) =>
    normalized
      .split(',')
      .map((item) => item.trim())
      .includes(option),
  )
}

export function normalizeWelderStampWeldType(value: string) {
  return splitWelderStampWeldTypes(value).join(', ')
}

export function formatWelderStampDiameterRange(record: WelderStampRecord) {
  const from = record.diameterFrom.trim()
  const to = record.diameterTo.trim()

  if (from && to) return `${from} - ${to}`
  if (from) return `от ${from}`
  if (to) return `до ${to}`
  return '-'
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
  return weldType ? `Клеймо ${naksStamp} (тип: ${weldType})` : `Клеймо ${naksStamp}`
}

export function formatWelderStampTaskLabel(task: WelderStampExpiryTask) {
  return formatWelderStampRecordLabel(task.stamp)
}

export function formatWelderStampCompactLabel(task: WelderStampExpiryTask) {
  return `Клеймо ${task.naksStamp.trim() || '-'}`
}
