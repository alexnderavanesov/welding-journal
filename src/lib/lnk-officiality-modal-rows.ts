import { compactSearchText, normalizeSearchText } from '@/lib/report-row-utils'
import type { WeldRow } from '@/lib/dispatcher-types'

export function filterLnkOfficialityRows(rows: WeldRow[], search: string) {
  const query = normalizeSearchText(search)
  const compactQuery = compactSearchText(query)
  if (!query) return rows

  return rows.filter((row) => {
    const values = [row.projectTitle, row.subtitleCode, row.line, row.spool, row.joint, row.officiality]
    const haystack = normalizeSearchText(values.map((value) => String(value ?? '')).join(' '))
    return haystack.includes(query) || compactSearchText(haystack).includes(compactQuery)
  })
}
