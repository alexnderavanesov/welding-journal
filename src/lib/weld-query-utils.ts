import type { QueryClient } from '@tanstack/react-query'

export const WELD_JOINTS_QUERY_KEY = ['weld-joints'] as const
export const WELD_JOINT_PAGES_QUERY_KEY = ['weld-joint-pages'] as const
export const DISPATCHER_TASK_SNAPSHOT_QUERY_KEY = ['dispatcher-task-snapshot'] as const
export const DISPATCHER_BACKGROUND_STATUS_QUERY_KEY = ['dispatcher-background-status'] as const
export const STATISTICS_SERVER_QUERY_KEY = ['statistics-server'] as const

export async function invalidateWeldJoints(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: WELD_JOINTS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: WELD_JOINT_PAGES_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: STATISTICS_SERVER_QUERY_KEY }),
  ])
}
