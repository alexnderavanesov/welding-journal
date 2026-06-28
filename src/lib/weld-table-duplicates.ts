import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

const DUPLICATE_CHECK_FIELD_KEYS: WeldFieldKey[] = [
  'projectTitle',
  'subtitleCode',
  'line',
  'joint',
]

export function getDuplicateKeys(rows: WeldRow[]) {
  const counts = new Map<string, number>()

  for (const row of rows) {
    const key = getDuplicateKey(row)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key))
}

export function getDuplicateKey(row: WeldInput) {
  if (isUnofficialJoint(row)) return null
  const values = DUPLICATE_CHECK_FIELD_KEYS.map((key) => normalizeDuplicateValue(row[key]))
  if (values.every((value) => value === '')) return null
  return values.join('|')
}

function isUnofficialJoint(row: WeldInput) {
  const status = normalizeDuplicateValue(row.status)
  return status === 'неофициальный'
}

function normalizeDuplicateValue(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\s+/g, '').trim().toLowerCase()
}
