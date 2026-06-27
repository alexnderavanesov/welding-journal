import type { WeldInput } from '@/lib/weld-fields'

type WeldRow = WeldInput & { id: number }

export function hasColumnFilters(columnFilters: Record<string, string>) {
  return Object.values(columnFilters).some((value) => value.trim())
}

export function filterWeldRowsByColumns<Row extends WeldRow>(rows: Row[], columnFilters: Record<string, string>) {
  return rows.filter((row) =>
    Object.entries(columnFilters).every(([key, value]) => matchesWeldColumnFilter(row, key, value)),
  )
}

function matchesWeldColumnFilter(row: WeldRow, key: string, value: string) {
  const query = value.trim().toLowerCase()
  if (!query) return true

  const cellValue = row[key as keyof typeof row]
  const normalized = cellValue === true ? 'да' : cellValue === false || cellValue == null ? '' : String(cellValue)
  const normalizedText = normalized.trim().toLowerCase()
  if (query.startsWith('=')) {
    return normalizedText === query.slice(1).trim().replace(/^["']|["']$/g, '')
  }
  return normalizedText.includes(query)
}
