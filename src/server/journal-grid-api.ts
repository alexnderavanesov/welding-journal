import { createServerFn } from '@tanstack/react-start'
import type { JournalSelectionCountRequest } from '@/lib/journal-selection-counts'
import type { JournalGridRequest, JournalGridQuery, JournalRangeRequest, JournalRevision } from '@/lib/journal-server-grid'

export const readJournalGrid = createServerFn({ method: 'POST' })
  .validator((data: JournalGridRequest) => data)
  .handler(async ({ data }) => (await import('./journal-grid')).readJournalGrid(data))
export const readJournalGridBlocks = createServerFn({ method: 'POST' })
  .validator((data: import('@/lib/journal-server-grid').JournalGridBlocksRequest) => data)
  .handler(async ({ data }) => (await import('./journal-grid')).readJournalGridBlocks(data, (await import('@tanstack/react-start/server')).getRequest().signal))
export const selectJournalGridRows = createServerFn({ method: 'POST' })
  .validator((data: JournalGridQuery & { route: string[]; revision: JournalRevision }) => data)
  .handler(async ({ data }) => (await import('./journal-grid')).selectJournalGridRows(data))
export const selectJournalGridRange = createServerFn({ method: 'POST' })
  .validator((data: JournalRangeRequest) => data)
  .handler(async ({ data }) => (await import('./journal-grid-range')).selectJournalGridRange(data, (await import('@tanstack/react-start/server')).getRequest().signal))
export const summarizeJournalGridRange = createServerFn({ method: 'POST' })
  .validator((data: JournalRangeRequest) => data)
  .handler(async ({ data }) => (await import('./journal-grid-range')).summarizeJournalGridRange(data, (await import('@tanstack/react-start/server')).getRequest().signal))
export const copyJournalGridRange = createServerFn({ method: 'POST' })
  .validator((data: JournalRangeRequest) => data)
  .handler(async ({ data }) => (await import('./journal-grid-range')).copyJournalGridRange(data, (await import('@tanstack/react-start/server')).getRequest().signal))
export const countJournalGridSelection = createServerFn({ method: 'POST' })
  .validator((data: JournalSelectionCountRequest) => data)
  .handler(async ({ data }) => (await import('./journal-grid')).countJournalGridSelection(data))
export const summarizeJournalGridSelection = createServerFn({ method: 'POST' })
  .validator((data: { ids: number[]; snapshot?: import('@/lib/journal-selection-summary').JournalSelectionSnapshot }) => data)
  .handler(async ({ data }) => (await import('./journal-grid')).summarizeJournalGridSelection(data, (await import('@tanstack/react-start/server')).getRequest().signal))
export const summarizeJournalGridArea = createServerFn({ method: 'POST' })
  .validator((data: JournalRangeRequest) => data)
  .handler(async ({ data }) => (await import('./journal-grid-range')).summarizeJournalGridArea(data, (await import('@tanstack/react-start/server')).getRequest().signal))

// Large journal choices travel in request bodies, not GET URLs.
export const listJournalReportRows = createServerFn({ method: 'POST' })
  .validator((data: import('./weld-contracts').WeldPageRequest) => data)
  .handler(async ({ data }) => (await import('./weld-read')).listWeldingJournalPage({ data }))
export const getJournalReportSummary = createServerFn({ method: 'POST' })
  .validator((data: import('./weld-contracts').WeldReportSummaryRequest & { revision?: JournalRevision }) => data)
  .handler(async ({ data }) => {
    const { assertJournalRevision, peekJournalReportCount } = await import('./journal-grid')
    if (data?.revision !== undefined) {
      await (await import('./security-functions')).assertSecurityScope('entry')
      await assertJournalRevision(data.revision, data.columnFilters)
    }
    // The footer must describe the displayed version, not a newer writer's
    // count which happened to finish while those rows were on screen.
    const summary = await (await import('./weld-read')).getWeldReportSummary({ data }, normalized => peekJournalReportCount(normalized, data?.revision))
    if (data?.revision !== undefined) await assertJournalRevision(data.revision, data.columnFilters)
    return summary
  })
export const listJournalFilterOptions = createServerFn({ method: 'POST' })
  .validator((data: import('./weld-contracts').WeldColumnFilterOptionsRequest) => data)
  .handler(async ({ data }) => (await import('./weld-read')).listWeldColumnFilterOptions({ data }))
export const readJournalFilterPage = createServerFn({ method: 'POST' })
  .validator((data: import('@/lib/journal-filter-options').JournalFilterRequest) => data)
  .handler(async ({ data }) => (await import('./journal-filter-options')).readJournalFilterPage(data))
export const selectJournalFilterValues = createServerFn({ method: 'POST' })
  .validator((data: import('@/lib/journal-filter-options').JournalFilterRequest) => data)
  .handler(async ({ data }) => (await import('./journal-filter-options')).selectJournalFilterValues(data))
