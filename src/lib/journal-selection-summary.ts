import type { WeldGroupSummary } from './weld-group-summary'
import type { JournalRangeRequest } from './journal-server-grid'

export type JournalSummaryRange = { request: JournalRangeRequest | null; error?: string } | null

export type JournalSelectionSummary = Pick<WeldGroupSummary, 'joints' | 'wdi' | 'missingWdi' | 'weldDate' | 'missingDates'> & {
  records: number
}
