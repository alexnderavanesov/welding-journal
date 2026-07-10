import type { WeldInput } from '@/lib/weld-fields'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export type TemplateStampNameFieldKey = 'stamp1K' | 'stamp1Z' | 'stamp1O' | 'stamp2K' | 'stamp2Z' | 'stamp2O'

const OFFICIAL_STAMP_KEYS: TemplateStampNameFieldKey[] = [
  'stamp1K',
  'stamp1Z',
  'stamp1O',
  'stamp2K',
  'stamp2Z',
  'stamp2O',
]

export const STAMP_NAME_TEMPLATE_FIELDS: Array<{ label: string; key: TemplateStampNameFieldKey }> = [
  { label: 'Корень_1', key: 'stamp1K' },
  { label: 'Заполнение_1', key: 'stamp1Z' },
  { label: 'Облицовка_1', key: 'stamp1O' },
  { label: 'Корень_2', key: 'stamp2K' },
  { label: 'Заполнение_2', key: 'stamp2Z' },
  { label: 'Облицовка_2', key: 'stamp2O' },
]

export function getWelderNamesForOfficialStamps(record: WeldInput, welderStamps: WelderStampRecord[]) {
  if (!welderStamps.length) return ''

  const nameByStamp = buildWelderNameMap(welderStamps)
  const names = new Set<string>()

  for (const key of OFFICIAL_STAMP_KEYS) {
    const stamp = String(record[key] ?? '').trim()
    if (!stamp) continue

    const name = nameByStamp.get(normalizeStamp(stamp))?.trim()
    if (name) names.add(name)
  }

  return Array.from(names).join(', ')
}

export function getWelderNameForTemplateStamp(record: WeldInput, key: TemplateStampNameFieldKey, welderStamps: WelderStampRecord[]) {
  if (!welderStamps.length) return ''

  const stamp = String(record[key] ?? '').trim()
  if (!stamp) return ''

  return buildWelderNameMap(welderStamps).get(normalizeStamp(stamp))?.trim() ?? ''
}

function buildWelderNameMap(records: WelderStampRecord[]) {
  const map = new Map<string, string>()

  for (const record of records) {
    const name = record.welderName.trim()
    if (!name) continue

    const naksStamp = record.naksStamp.trim()
    if (naksStamp && !map.has(normalizeStamp(naksStamp))) map.set(normalizeStamp(naksStamp), name)
  }

  for (const record of records) {
    const name = record.welderName.trim()
    if (!name) continue

    const internalStamp = record.internalStamp.trim()
    if (internalStamp && !map.has(normalizeStamp(internalStamp))) map.set(normalizeStamp(internalStamp), name)
  }

  return map
}

function normalizeStamp(value: string) {
  return value.trim().toUpperCase()
}
