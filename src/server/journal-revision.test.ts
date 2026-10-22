import { beforeEach, expect, it, vi } from 'vitest'
import { DERIVED_CALCULATION_REVISION_FLOOR } from '@/lib/derived-calculation-cache-version'

const mocks = vi.hoisted(() => ({ read: vi.fn(), initialize: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ select: () => ({ from: () => ({ where: mocks.read }) }) }) }))
vi.mock('./derived-calculation-cache', async importOriginal => ({
  ...await importOriginal<typeof import('./derived-calculation-cache')>(),
  readCacheSnapshotCoalesced: mocks.initialize,
}))
vi.mock('./report-task-publication-cache-key', () => ({ getReportTaskPublicationCacheIdentity: async () => ({}) }))
import { journalRevision } from './journal-grid'

beforeEach(() => vi.clearAllMocks())

it.each([undefined, 3])('initializes an old or missing cache revision (%s) before the journal pins rows', async revision => {
  mocks.read.mockResolvedValue(revision === undefined ? [] : [{ revision }])
  mocks.initialize.mockResolvedValue({ sourceRevision: DERIVED_CALCULATION_REVISION_FLOOR + 1, payload: null })
  expect(await journalRevision()).toBe(DERIVED_CALCULATION_REVISION_FLOOR + 1)
  expect(mocks.initialize).toHaveBeenCalledOnce()
})

it('keeps the normal revision read free of cache writes and extra queries', async () => {
  mocks.read.mockResolvedValue([{ revision: DERIVED_CALCULATION_REVISION_FLOOR + 7 }])
  expect(await journalRevision()).toBe(DERIVED_CALCULATION_REVISION_FLOOR + 7)
  expect(mocks.read).toHaveBeenCalledOnce()
  expect(mocks.initialize).not.toHaveBeenCalled()
})
