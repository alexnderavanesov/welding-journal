import { createServerFn } from '@tanstack/react-start'
import type { WorkClosureChange } from '@/lib/work-closures'

export const readWorkClosures = createServerFn({ method: 'POST' })
  .validator((data: { ids: number[] }) => data)
  .handler(async ({ data }) => (await import('./work-closures')).readClosures(data.ids))

type ClosureReportRequest = { columnFilters: Record<string, string>; dimension: import('@/lib/work-closure-columns').ClosureDimension }
export const readWorkClosureFacet = createServerFn({ method: 'POST' })
  .validator((data: ClosureReportRequest) => data)
  .handler(async ({ data }) => (await import('./work-closures')).readClosureFacet(data.columnFilters, data.dimension))

export const readWorkClosureValues = createServerFn({ method: 'GET' })
  .handler(async () => (await import('./work-closures')).readClosureValues())

export const readWorkClosureSummary = createServerFn({ method: 'POST' })
  .validator((data: ClosureReportRequest) => data)
  .handler(async ({ data }) => (await import('./work-closures')).readClosureSummary(data.columnFilters, data.dimension))

export const saveJointWorkClosures = createServerFn({ method: 'POST' })
  .validator((data: { changes: WorkClosureChange[] }) => data)
  .handler(async ({ data }) => (await import('./work-closures')).writeClosures(data.changes, 'card'))

export const saveBulkWorkClosures = createServerFn({ method: 'POST' })
  .validator((data: { changes: WorkClosureChange[]; overwriteExisting?: boolean }) => data)
  .handler(async ({ data }) => (await import('./work-closures')).writeClosures(data.changes, 'bulk', data.overwriteExisting === true))
