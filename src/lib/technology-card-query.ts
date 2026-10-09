import { useQuery } from '@tanstack/react-query'
import { getTechnologyCardSnapshot } from '@/server/technology-cards-api'

export const TECHNOLOGY_CARDS_QUERY_KEY = ['technology-cards'] as const
export function useTechnologyCardSnapshot() {
  return useQuery({ queryKey: [...TECHNOLOGY_CARDS_QUERY_KEY, 'snapshot'], queryFn: () => getTechnologyCardSnapshot(),
    staleTime: 30_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false })
}
