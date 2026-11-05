import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { StatisticsServerRequest } from '@/lib/statistics-server-summary'
import { STATISTICS_SERVER_QUERY_KEY } from '@/lib/weld-query-utils'
import { getStatisticsServerResult } from '@/server/statistics'
import { unpackStatisticsResult, STATISTICS_TRANSPORT } from '@/lib/statistics-result-payload'

export function useStatisticsServerQuery(request: StatisticsServerRequest) {
  return useQuery({
    queryKey: [...STATISTICS_SERVER_QUERY_KEY, request],
    queryFn: async () => unpackStatisticsResult(await getStatisticsServerResult({ data: { ...request, transport: STATISTICS_TRANSPORT } })),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
