import { beforeEach, expect, it, vi } from 'vitest'
import { DERIVED_CALCULATION_REVISION_FLOOR } from '@/lib/derived-calculation-cache-version'
const mock = vi.hoisted(() => ({ peek: vi.fn(), revision: vi.fn() }))
vi.mock('./journal-count-cache', () => ({ createJournalCountCache: () => Object.assign(vi.fn(), { peek: mock.peek }) }))
vi.mock('@/db', () => ({ requireDb: () => ({ select: () => ({ from: () => ({ where: mock.revision }) }) }) }))
vi.mock('./report-task-publication-cache-key', () => ({ getReportTaskPublicationCacheIdentity: async () => ({}) }))
import { peekJournalReportCount } from './journal-grid'
import { normalizeWeldPageRequest } from './weld-read'
const revision = DERIVED_CALCULATION_REVISION_FLOOR + 1
beforeEach(() => {
  vi.clearAllMocks()
  mock.peek.mockReturnValue(Promise.resolve(42))
  mock.revision.mockResolvedValue([{ revision }])
})
it('checks the live revision even when an old cached count exists', async () => {
  const data = normalizeWeldPageRequest({ report: 'weldingJournal', search: 'P', columnFilters: { line: '=L' } })
  expect(await peekJournalReportCount(data, revision)).toBe(42)
  expect(mock.revision).toHaveBeenCalledOnce()
  mock.revision.mockResolvedValue([{ revision: revision + 1 }])
  await expect(peekJournalReportCount(data, revision)).rejects.toThrow('изменились')
})
it('keeps reports, filter sets, quick search and revisions separate; sorting never changes membership', async () => {
  const base = { report: 'weldingJournal' as const, search: 'P', columnFilters: { line: '=L' } }
  for (const props of [base, { ...base, report: 'lnk' as const }, { ...base, search: 'Q' }, { ...base, columnFilters: { line: '=M' } }]) {
    await peekJournalReportCount(normalizeWeldPageRequest(props), revision)
  }
  expect(new Set(mock.peek.mock.calls.map(([key]) => key)).size).toBe(4)
  await peekJournalReportCount(normalizeWeldPageRequest({ ...base, sort: { fieldKey: 'joint', direction: 'desc' } }), revision)
  expect(mock.peek.mock.lastCall![0]).toBe(mock.peek.mock.calls[0][0])
})
it('falls back for uncached, unpinned or legacy top-level selections', async () => {
  for (const props of [{ projectTitle: 'P' }, { controlMethod: 'ВИК' }, { status: 'действующий' }]) {
    expect(await peekJournalReportCount(normalizeWeldPageRequest(props), revision)).toBeUndefined()
  }
  expect(await peekJournalReportCount(normalizeWeldPageRequest({}))).toBeUndefined()
  expect(mock.peek).not.toHaveBeenCalled()
  mock.peek.mockReturnValue(undefined)
  expect(await peekJournalReportCount(normalizeWeldPageRequest({}), revision)).toBeUndefined()
  expect(mock.revision).not.toHaveBeenCalled()
})
