import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from '@/lib/report-common-config'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

export function getOfficialWeldRowStamps(row: WeldRow) {
  const stamps: string[] = []
  const seen = new Set<string>()

  for (const fieldKey of OFFICIAL_WELDER_STAMP_FIELD_KEYS) {
    const stamp = String(row[fieldKey] ?? '').trim()
    const normalized = normalizeStamp(stamp)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    stamps.push(stamp)
  }

  return stamps
}

export function findOfficialWeldRowStampField(
  row: WeldRow,
  stamp: string,
): WeldFieldKey | null {
  const normalizedStamp = normalizeStamp(stamp)
  if (!normalizedStamp) return null

  return OFFICIAL_WELDER_STAMP_FIELD_KEYS.find(
    (fieldKey) => normalizeStamp(row[fieldKey]) === normalizedStamp,
  ) ?? null
}

function normalizeStamp(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU')
}
