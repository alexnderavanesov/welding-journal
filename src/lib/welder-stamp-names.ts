import type { WeldInput } from '@/lib/weld-fields'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

const FACT_STAMP_KEYS: Array<keyof WeldInput> = [
  'stamp1KFact',
  'stamp1ZFact',
  'stamp1OFact',
  'stamp2KFact',
  'stamp2ZFact',
  'stamp2OFact',
]

export function getWelderNamesForFactStamps(record: WeldInput, welderStamps: WelderStampRecord[]) {
  if (!welderStamps.length) return ''

  const nameByStamp = buildWelderNameMap(welderStamps)
  const names = new Set<string>()

  for (const key of FACT_STAMP_KEYS) {
    const stamp = String(record[key] ?? '').trim()
    if (!stamp) continue

    const name = nameByStamp.get(normalizeStamp(stamp))?.trim()
    if (name) names.add(name)
  }

  return Array.from(names).join(', ')
}

function buildWelderNameMap(records: WelderStampRecord[]) {
  const map = new Map<string, string>()

  for (const record of records) {
    const name = record.welderName.trim()
    if (!name) continue

    const naksStamp = record.naksStamp.trim()
    const internalStamp = record.internalStamp.trim()
    if (naksStamp && !map.has(normalizeStamp(naksStamp))) map.set(normalizeStamp(naksStamp), name)
    if (internalStamp && !map.has(normalizeStamp(internalStamp))) map.set(normalizeStamp(internalStamp), name)
  }

  return map
}

function normalizeStamp(value: string) {
  return value.trim().toUpperCase()
}
