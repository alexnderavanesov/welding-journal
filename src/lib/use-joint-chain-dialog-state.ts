import { useQuery } from '@tanstack/react-query'
import type { WeldRow } from '@/lib/dispatcher-types'
import { listWeldJointChain } from '@/server/weld-read-api'

type UseJointChainDialogStateOptions = {
  chainRecord: WeldRow | null
}

export function useJointChainDialogState({
  chainRecord,
}: UseJointChainDialogStateOptions) {
  const chainQuery = useQuery({
    queryKey: ['weld-joint-chain', chainRecord?.id ?? null],
    queryFn: async () => listWeldJointChain({ data: { id: chainRecord!.id } }),
    enabled: Boolean(chainRecord),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  return {
    chainRows: chainQuery.data?.rows ?? [],
    chainTransitions: chainQuery.data?.transitions ?? [],
    chainEarlyCoilCandidates: chainQuery.data?.earlyCoilCandidates ?? [],
    chainRowsError: chainQuery.error instanceof Error ? chainQuery.error.message : null,
    isChainRowsLoading: chainQuery.isLoading,
    retryChainRows: () => chainQuery.refetch(),
  }
}
