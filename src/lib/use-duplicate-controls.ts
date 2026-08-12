import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteDuplicateControl, listDuplicateControls, saveDuplicateControls, type DuplicateControlPayload } from '@/server/duplicate-controls'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'

export const DUPLICATE_CONTROLS_QUERY_KEY = ['duplicate-controls'] as const

export function useDuplicateControls({ enabled = true }: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient()
  const duplicateControlsQuery = useQuery({
    queryKey: DUPLICATE_CONTROLS_QUERY_KEY,
    queryFn: async () => listDuplicateControls(),
    enabled,
    staleTime: 30_000,
  })

  const saveDuplicateControlMutation = useMutation({
    mutationFn: async (records: DuplicateControlPayload[]) => saveDuplicateControls({ data: { records } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: DUPLICATE_CONTROLS_QUERY_KEY })
      await invalidateWeldJoints(queryClient)
    },
  })

  const deleteDuplicateControlMutation = useMutation({
    mutationFn: async (id: number) => deleteDuplicateControl({ data: { id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: DUPLICATE_CONTROLS_QUERY_KEY })
      await invalidateWeldJoints(queryClient)
    },
  })

  return {
    duplicateControls: duplicateControlsQuery.data ?? [],
    saveDuplicateControlMutation,
    deleteDuplicateControlMutation,
  }
}
