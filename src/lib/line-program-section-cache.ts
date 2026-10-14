import type { QueryClient, QueryFilters } from '@tanstack/react-query'
import type { LineProgramRecord } from './line-program'
import type { LineProgramOverview } from './line-program-overview'

type LineSummary = LineProgramRecord & { overview?: LineProgramOverview; searchStamps?: string[] }
type LineSnapshot = { rows: LineSummary[] }

// Includes the legacy ['line-program', 'section'] entry without creating it.
const listQueries = {
  queryKey: ['line-program'],
  predicate: query => query.queryKey[1] === 'section' || query.queryKey[1] === 'page',
} satisfies QueryFilters

/** Patch complete summaries in every existing section/page that contains the line.
 * Resolves after cancellation and patching; active lists refresh in the background.
 * Callers still await their scoped line details, never the complete selection. */
export async function updateLineProgramSectionCaches(
  client: QueryClient,
  line: LineSummary,
  { membershipChanged = false }: { membershipChanged?: boolean } = {},
) {
  // Cancellation must precede the patch: reverting a pending read afterwards
  // would restore its pre-save snapshot, and a late response could overwrite it.
  await client.cancelQueries(listQueries)
  client.setQueriesData<LineSnapshot>({
    ...listQueries,
    predicate: query => listQueries.predicate(query) &&
      !!(query.state.data as LineSnapshot | undefined)?.rows.some(row => row.id === line.id),
  }, previous => previous ? {
    ...previous,
    rows: previous.rows.map(row => row.id === line.id ? { ...row, ...line } : row),
  } : previous)

  if (membershipChanged) {
    // Do not guess search membership, ordering or page totals after a rename,
    // creation or changed norm. Inactive selections stay stale until opened.
    void client.invalidateQueries({ ...listQueries, refetchType: 'active' })
  } else {
    // An initial read has no snapshot to patch. Resume active readers so
    // cancellation cannot leave a newly selected search permanently pending.
    void client.invalidateQueries({
      ...listQueries,
      predicate: query => listQueries.predicate(query) && query.state.data === undefined,
      refetchType: 'active',
    })
  }
}
