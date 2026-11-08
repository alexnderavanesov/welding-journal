import { beforeEach, expect, it, vi } from 'vitest'
import type { JournalRangeRequest } from '@/lib/journal-server-grid'
import { pasteJournalCells } from './journal-inline-edit'

const calls = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), database: vi.fn() }))
vi.mock('./access-context', () => ({ requirePermission: async () => ({
  id: 'welder', name: 'Welder', email: '', title: '', role: 'user', revision: 1,
  permissions: ['welding.view', 'welding.edit'],
}) }))
vi.mock('./security-functions', () => ({ assertSecurityScope: async () => {} }))
vi.mock('./journal-grid', () => ({ journalReadContext: calls.read, journalRouteWhere: vi.fn(), assertJournalContextRevision: vi.fn() }))
vi.mock('./journal-cell-write', () => ({ writeJournalCells: calls.write }))
vi.mock('@/db', () => ({ requireDb: calls.database }))

beforeEach(() => {
  vi.clearAllMocks()
  calls.read.mockRejectedValue(new Error('Reached authorized query'))
})
const range = (): JournalRangeRequest => ({ report: 'weldingJournal', revision: 1, anchor: '',
  columnFilters: {}, groupBy: [], parts: [{ route: [], start: 0, end: 1, columns: ['weldingJournalNote'] }],
})

it.each([
  { name: 'hidden LNK filter', query: { columnFilters: { lnkNote: '=private' } } },
  { name: 'hidden PSTO filter', query: { columnFilters: { pstoResult: '=проведено' } } },
  { name: 'hidden sorting', query: { sort: { fieldKey: 'pstoResult', direction: 'asc' } } },
  { name: 'hidden grouping', query: { groupBy: ['lnkNote'], parts: [{ route: ['private'], start: 0, end: 1, columns: ['weldingJournalNote'] }] } },
  { name: 'cross-area search', query: { columnFilters: { search: 'private' } } },
])('rejects $name before reading or changing a journal range', async ({ query }) => {
  await expect(pasteJournalCells({ range: { ...range(), ...query } as JournalRangeRequest, values: [['']] })).rejects.toThrow(/недоступ|требует просмотра/)
  expect(calls.read).not.toHaveBeenCalled()
  expect(calls.database).not.toHaveBeenCalled()
  expect(calls.write).not.toHaveBeenCalled()
})

it('retains an authorized journal filter, sort and grouping for paste or clear', async () => {
  const input = { ...range(), columnFilters: { isometry: '=ISO-1' }, groupBy: ['isometry'],
    sort: { fieldKey: 'sheet', direction: 'asc' }, parts: [{ route: ['ISO-1'], start: 0, end: 1, columns: ['fillerWire'] }],
  } as JournalRangeRequest
  await expect(pasteJournalCells({ range: input, values: [['']] })).rejects.toThrow('Reached authorized query')
  expect(calls.read).toHaveBeenCalledOnce()
})
