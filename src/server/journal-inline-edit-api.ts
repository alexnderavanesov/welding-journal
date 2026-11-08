import { createServerFn } from '@tanstack/react-start'
import type { JournalCellEdit } from '@/lib/journal-inline-edit'
import type { JournalRangeRequest } from '@/lib/journal-server-grid'

export const saveJournalCellEdits = createServerFn({ method: 'POST' })
  .validator((data: { edits: JournalCellEdit[] }) => data)
  .handler(async ({ data }) => (await import('./journal-inline-edit')).saveJournalCellEdits(data))

export const pasteJournalCells = createServerFn({ method: 'POST' })
  .validator((data: { range: JournalRangeRequest; values: string[][] }) => data)
  .handler(async ({ data }) => (await import('./journal-inline-edit')).pasteJournalCells(data))
