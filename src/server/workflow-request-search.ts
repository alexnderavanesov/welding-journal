import { sql, type SQL } from 'drizzle-orm'
import { normalizeSearchText } from '@/lib/report-row-utils'

// These lookups return request identities, never the first page of their joints.
export function workflowRequestSearchWhere(search: string, name: SQL, date: SQL) {
  if (!search) return sql`true`
  const pattern = `%${normalizeSearchText(search).replace(/[\\%_]/g, '\\$&')}%`
  return sql`btrim(regexp_replace(replace(lower(concat_ws(' ', ${name}, ${date}, to_char(nullif(${date}, '')::date, 'DD.MM.YYYY'))), 'ё', 'е'), '\\s+', ' ', 'g')) like ${pattern}`
}
