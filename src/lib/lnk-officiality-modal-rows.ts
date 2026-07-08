import { compactSearchText, compareLnkRequestRows, normalizeSearchText } from '@/lib/report-row-utils'
import type { WeldRow } from '@/lib/dispatcher-types'

export function filterLnkOfficialityRows(rows: WeldRow[], search: string, _selectedIds: Set<number>) {
  const query = normalizeSearchText(search)
  const compactQuery = compactSearchText(query)
  return rows
    .filter((row) => {
      if (!query) return true
      const values = [row.projectTitle, row.subtitleCode, row.line, row.spool, row.joint, row.status]
      const haystack = normalizeSearchText(values.map((value) => String(value ?? '')).join(' '))
      return haystack.includes(query) || compactSearchText(haystack).includes(compactQuery)
    })
    .sort(compareLnkRequestRows)
}
