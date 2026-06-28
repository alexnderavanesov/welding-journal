import type { QueryClient } from '@tanstack/react-query'

export const WELD_JOINTS_QUERY_KEY = ['weld-joints'] as const

export async function invalidateWeldJoints(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: WELD_JOINTS_QUERY_KEY })
}
