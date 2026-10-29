import type { WeldGroupSummary } from './weld-group-summary'
import type { JournalRangeRequest, JournalRevision } from './journal-server-grid'

export type JournalSummaryRange = { request: JournalRangeRequest | null; error?: string } | null

export type JournalSelectionSummary = Pick<WeldGroupSummary, 'joints' | 'wdi' | 'missingWdi' | 'weldDate' | 'missingDates'> & {
  records: number
}

export type JournalSelectionSnapshot = { revision: JournalRevision; columnFilters: Record<string, string> }
