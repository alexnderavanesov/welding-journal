import { useQuery } from '@tanstack/react-query'
import { loadWeldSnapshot } from '@/lib/weld-snapshot'
import {
  WELD_COMPLETE_SNAPSHOT_QUERY_KEY,
  WELD_FINAL_STATUS_CONTEXT_QUERY_KEY,
  WELD_REPORT_CONTEXT_QUERY_KEY,
} from '@/lib/weld-query-utils'
import {
  WELD_SNAPSHOT_BATCH_SIZE,
  listWeldFinalStatusContextKeys,
  listWeldReportContextRows,
  listWeldJointSnapshotPage,
  type WeldReportContextKind,
} from '@/server/welds'

export function useWeldsQuery({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: WELD_COMPLETE_SNAPSHOT_QUERY_KEY,
    queryFn: ({ signal }) =>
      loadWeldSnapshot({
        signal,
        fetchPage: (afterId) =>
          listWeldJointSnapshotPage({
            data: {
              afterId,
              batchSize: WELD_SNAPSHOT_BATCH_SIZE,
            },
          }),
      }),
    enabled,
    staleTime: 15_000,
  })
}

export function useWeldReportContextQuery({
  enabled,
  report,
}: {
  enabled: boolean
  report: WeldReportContextKind
}) {
  return useQuery({
    queryKey: [...WELD_REPORT_CONTEXT_QUERY_KEY, report],
    queryFn: () => listWeldReportContextRows({ data: { report } }),
    enabled,
    staleTime: 60_000,
    gcTime: 15 * 60_000,
  })
}

export function useWeldFinalStatusContextQuery({ enabled }: { enabled: boolean }) {
  return useQuery({
    queryKey: WELD_FINAL_STATUS_CONTEXT_QUERY_KEY,
    queryFn: () => listWeldFinalStatusContextKeys(),
    enabled,
    staleTime: 60_000,
    gcTime: 15 * 60_000,
  })
}
