import type { QueryClient } from '@tanstack/react-query'

import { splitReportQuickSearch } from '@/lib/report-quick-search'
import { WELD_REPORT_CONTEXT_QUERY_KEY } from '@/lib/weld-query-utils'
import {
  listHeatTreatmentReportPage,
  listLnkReportPage,
  listWeldReportContextRows,
} from '@/server/weld-read-api'
import { WELD_PAGE_ALL_SIZE, type WeldReportContextKind, type WeldSort } from '@/server/weld-contracts'

/** Complete source for an explicitly requested report, without modal candidate limits. */
export function loadCompleteReportOutputRows(
  queryClient: QueryClient,
  report: WeldReportContextKind,
) {
  return queryClient.fetchQuery({
    queryKey: [...WELD_REPORT_CONTEXT_QUERY_KEY, report],
    queryFn: () => listWeldReportContextRows({ data: { report } }),
    staleTime: 60_000,
    retry: false,
  })
}

export async function loadFilteredCurrentReportOutputRows({
  report,
  columnFilters,
  sort,
}: {
  report: WeldReportContextKind
  columnFilters: Record<string, string>
  sort: WeldSort | null
}) {
  const filters = splitReportQuickSearch(columnFilters)
  const request = {
    data: {
      page: 1,
      pageSize: WELD_PAGE_ALL_SIZE as typeof WELD_PAGE_ALL_SIZE,
      columnFilters: filters.columnFilters,
      ...(filters.search ? { search: filters.search } : {}),
      ...(sort ? { sort } : {}),
    },
  }
  const result = report === 'lnk'
    ? await listLnkReportPage(request)
    : await listHeatTreatmentReportPage(request)
  return result.rows
}
