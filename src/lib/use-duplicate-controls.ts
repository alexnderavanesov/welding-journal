import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteDuplicateControl, listDuplicateControls, saveDuplicateControl, type DuplicateControlPayload } from '@/server/duplicate-controls'

export const DUPLICATE_CONTROLS_QUERY_KEY = ['duplicate-controls'] as const

export function useDuplicateControls() {
  const queryClient = useQueryClient()
  const duplicateControlsQuery = useQuery({
    queryKey: DUPLICATE_CONTROLS_QUERY_KEY,
    queryFn: async () => listDuplicateControls(),
  })

  const saveDuplicateControlMutation = useMutation({
    mutationFn: async (record: DuplicateControlPayload) => saveDuplicateControl({ data: record }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: DUPLICATE_CONTROLS_QUERY_KEY })
      await queryClient.invalidateQueries({ queryKey: ['weld-joints'] })
    },
  })

  const deleteDuplicateControlMutation = useMutation({
    mutationFn: async (id: number) => deleteDuplicateControl({ data: { id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: DUPLICATE_CONTROLS_QUERY_KEY })
      await queryClient.invalidateQueries({ queryKey: ['weld-joints'] })
    },
  })

  return {
    duplicateControls: duplicateControlsQuery.data ?? [],
    duplicateControlsQuery,
    saveDuplicateControlMutation,
    deleteDuplicateControlMutation,
  }
}
