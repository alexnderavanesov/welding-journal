import { getHeatTreatmentImportKey } from '@/lib/report-import'
import type { WeldRow } from '@/lib/dispatcher-types'

export function buildUniqueRowsByHeatTreatmentImportKey<Row extends WeldRow>(rows: Row[]) {
  const rowsByKey = new Map<string, Row>()
  const duplicateKeys = new Set<string>()

  for (const row of rows) {
    const key = getHeatTreatmentImportKey(row)
    if (!key) continue
    if (rowsByKey.has(key)) {
      duplicateKeys.add(key)
      rowsByKey.delete(key)
      continue
    }
    if (!duplicateKeys.has(key)) rowsByKey.set(key, row)
  }

  return rowsByKey
}
