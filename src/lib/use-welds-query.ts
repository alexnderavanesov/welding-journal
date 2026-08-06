import { useQuery } from '@tanstack/react-query'
import { loadWeldSnapshot } from '@/lib/weld-snapshot'
import { WELD_JOINTS_QUERY_KEY } from '@/lib/weld-query-utils'
import {
  WELD_SNAPSHOT_BATCH_SIZE,
  listWeldJointSnapshotPage,
} from '@/server/welds'

export function useWeldsQuery({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...WELD_JOINTS_QUERY_KEY, 'complete-snapshot'],
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
