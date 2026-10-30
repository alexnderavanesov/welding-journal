import { createServerFn } from '@tanstack/react-start'
import type * as History from './activity-history'
export const listActivityHistory = createServerFn({ method: 'POST' }).validator((data: History.HistoryRequest) => data)
  .handler(async ({ data }) => (await import('./activity-history')).listActivityHistory(data))
export const getActivityDetails = createServerFn({ method: 'POST' }).validator((data: Parameters<typeof History.getActivityDetails>[0]) => data)
  .handler(async ({ data }) => (await import('./activity-history')).getActivityDetails(data))
export const getActivityFilters = createServerFn({ method: 'POST' }).validator((data: Parameters<typeof History.getActivityFilters>[0]) => data)
  .handler(async ({ data }) => (await import('./activity-history')).getActivityFilters(data))
