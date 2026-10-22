import type { JournalRevision } from './journal-server-grid'
import type { JournalGridQuery } from './journal-server-grid'
export type JournalSelectionCountRequest = JournalGridQuery & {
  revision: JournalRevision
  ids?: number[]
  snapshot?: string
  routes: string[][]
}
export type JournalSelectionCountResult = {
  total: number
  counts: Record<string, number>
  snapshot?: string
  complete?: boolean
  expired?: boolean
}
