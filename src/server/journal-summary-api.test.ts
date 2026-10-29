import { beforeEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ access: vi.fn(), revision: vi.fn(), summary: vi.fn() }))
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => {
  const builder = { validator: (_validator: unknown) => builder, handler: (handler: unknown) => handler }
  return builder
} }))
vi.mock('./security-functions', () => ({ assertSecurityScope: mock.access }))
vi.mock('./journal-grid', () => ({ assertJournalRevision: mock.revision }))
vi.mock('./weld-read', () => ({ getWeldReportSummary: mock.summary }))
import { getJournalReportSummary } from './journal-grid-api'

beforeEach(() => {
  vi.resetAllMocks()
  mock.summary.mockResolvedValue({ total: 10 })
})
const data = { report: 'weldingJournal' as const, revision: 17, columnFilters: { search: 'P' } }

it('refuses an expired footer before calling the potentially rebuilding summary', async () => {
  mock.revision.mockRejectedValueOnce(new Error('Данные журнала изменились.'))
  await expect(getJournalReportSummary({ data })).rejects.toThrow('изменились')
  expect(mock.access).toHaveBeenCalledWith('entry')
  expect(mock.summary).not.toHaveBeenCalled()
})
it('checks access before reading the revision and keeps the post-read concurrency check', async () => {
  mock.access.mockRejectedValueOnce(new Error('denied'))
  await expect(getJournalReportSummary({ data })).rejects.toThrow('denied')
  expect(mock.revision).not.toHaveBeenCalled()
  mock.access.mockResolvedValue(undefined)
  mock.revision.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Данные журнала изменились.'))
  await expect(getJournalReportSummary({ data })).rejects.toThrow('изменились')
  expect(mock.summary).toHaveBeenCalledOnce()
})
it('returns a coherent footer and retains ordinary unpinned reads', async () => {
  expect(await getJournalReportSummary({ data })).toEqual({ total: 10 })
  expect(mock.revision).toHaveBeenCalledTimes(2)
  mock.revision.mockClear()
  expect(await getJournalReportSummary({ data: { report: 'weldingJournal' } })).toEqual({ total: 10 })
  expect(mock.revision).not.toHaveBeenCalled()
})
