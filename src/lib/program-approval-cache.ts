import type { QueryClient } from '@tanstack/react-query'
import { DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY } from './dispatcher-accepted-warning-query'
import { DISPATCHER_TASK_SNAPSHOT_QUERY_KEY, STATISTICS_SERVER_QUERY_KEY, WELD_JOINT_PAGES_QUERY_KEY, WELD_REPORT_CONTEXT_QUERY_KEY } from './weld-query-utils'

/** No document/result invalidations: a decision does not change any control process. */
export async function invalidateProgramApprovalCaches(client: QueryClient, lineId?: number) {
  await Promise.all([
    client.invalidateQueries({ queryKey: DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY, refetchType: 'active' }),
    client.invalidateQueries({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY, refetchType: 'active' }),
    client.invalidateQueries({ queryKey: STATISTICS_SERVER_QUERY_KEY, refetchType: 'none' }),
    client.invalidateQueries({ queryKey: WELD_JOINT_PAGES_QUERY_KEY, refetchType: 'none' }),
    client.invalidateQueries({ queryKey: WELD_REPORT_CONTEXT_QUERY_KEY, refetchType: 'none' }),
    ...(lineId == null ? [client.invalidateQueries({ queryKey: ['line-program'], refetchType: 'active' })] : [
      client.invalidateQueries({ queryKey: ['line-program', 'calculation', lineId], refetchType: 'active' }),
      client.invalidateQueries({ queryKey: ['line-program', 'rows', lineId], refetchType: 'active' }),
      client.invalidateQueries({ queryKey: ['line-program', 'explanation', lineId], refetchType: 'active' }),
      client.invalidateQueries({ queryKey: ['line-program', 'report'], refetchType: 'none' }),
    ]),
  ])
}
