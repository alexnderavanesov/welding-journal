import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { StatisticsServerRequest } from '@/lib/statistics-server-summary'
import { STATISTICS_SERVER_QUERY_KEY } from '@/lib/weld-query-utils'
import { getStatisticsServerResult } from '@/server/statistics'

export function useStatisticsServerQuery(request: StatisticsServerRequest) {
  return useQuery({
    queryKey: [...STATISTICS_SERVER_QUERY_KEY, request],
    queryFn: () => getStatisticsServerResult({ data: request }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
}
