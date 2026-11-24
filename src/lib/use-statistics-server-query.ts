import { useQuery } from '@tanstack/react-query'
import type { StatisticsServerRequest } from '@/lib/statistics-server-summary'
import { STATISTICS_SERVER_QUERY_KEY } from '@/lib/weld-query-utils'
import { getStatisticsServerResult } from '@/server/statistics'
import { unpackStatisticsResult, STATISTICS_TRANSPORT } from '@/lib/statistics-result-payload'
import { STATISTICS_RESULT_VERSION } from './statistics-result-version'

export function useStatisticsServerQuery(request: StatisticsServerRequest) {
  return useQuery({
    queryKey: [...STATISTICS_SERVER_QUERY_KEY, request, STATISTICS_RESULT_VERSION] as const,
    queryFn: async () => {
      const result = unpackStatisticsResult(await getStatisticsServerResult({ data: { ...request, transport: STATISTICS_TRANSPORT } }))
      if (result.formatVersion !== STATISTICS_RESULT_VERSION) throw new Error('Формат статистики обновлён. Обновите страницу и повторите расчёт.')
      return result
    },
    placeholderData: (previous, previousQuery) => {
      if (previous?.formatVersion !== STATISTICS_RESULT_VERSION) return undefined
      // Project options are global. Subtitle options belong to the previous project selection.
      return JSON.stringify(previousQuery?.queryKey[1].projectFilter) === JSON.stringify(request.projectFilter)
        ? previous : { ...previous, subtitleOptions: [] }
    },
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
