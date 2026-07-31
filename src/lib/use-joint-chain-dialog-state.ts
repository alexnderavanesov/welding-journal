import { useQuery } from '@tanstack/react-query'
import { useWindowEscapeKey } from '@/lib/use-window-escape-key'
import type { WeldRow } from '@/lib/dispatcher-types'
import { listWeldJointChain } from '@/server/welds'

type UseJointChainDialogStateOptions = {
  chainRecord: WeldRow | null
  onClose: () => void
}

export function useJointChainDialogState({
  chainRecord,
  onClose,
}: UseJointChainDialogStateOptions) {
  const chainQuery = useQuery({
    queryKey: ['weld-joint-chain', chainRecord?.id ?? null],
    queryFn: async () => listWeldJointChain({ data: { id: chainRecord!.id } }),
    enabled: Boolean(chainRecord),
  })

  useWindowEscapeKey(Boolean(chainRecord), (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    onClose()
  })

  return {
    chainRows: chainQuery.data?.rows ?? [],
    chainRowsError: chainQuery.error instanceof Error ? chainQuery.error.message : null,
    isChainRowsLoading: chainQuery.isLoading,
    retryChainRows: () => chainQuery.refetch(),
  }
}
