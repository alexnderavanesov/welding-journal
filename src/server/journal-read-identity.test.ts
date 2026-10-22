import { beforeEach, expect, it, vi } from 'vitest'
import { DERIVED_CALCULATION_REVISION_FLOOR } from '@/lib/derived-calculation-cache-version'

const mocks = vi.hoisted(() => ({ access: vi.fn(), read: vi.fn(), publication: vi.fn(), ensure: vi.fn(), fresh: vi.fn(), settings: vi.fn(), system: vi.fn(), where: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ select: () => ({ from: () => ({ where: mocks.read }) }) }) }))
vi.mock('./security-functions', () => ({ assertSecurityScope: mocks.access }))
vi.mock('./report-task-publication-cache-key', () => ({ getReportTaskPublicationCacheIdentity: mocks.publication }))
vi.mock('./dispatcher-task-index', async original => ({ ...await original<typeof import('./dispatcher-task-index')>(), ensureDispatcherTaskIndexFresh: mocks.ensure, isDispatcherTaskIndexFresh: mocks.fresh }))
vi.mock('./weld-server-shared', async original => ({ ...await original<typeof import('./weld-server-shared')>(), loadServerOtherSettings: mocks.settings }))
vi.mock('./line-program', async original => ({ ...await original<typeof import('./line-program')>(), loadProgramSystemIndexSettings: mocks.system }))
vi.mock('./weld-read', async original => ({ ...await original<typeof import('./weld-read')>(), buildReportQueryWhere: mocks.where }))
import { assertJournalContextRevision, journalReadContext, journalReadIdentity } from './journal-grid'

const revision = DERIVED_CALCULATION_REVISION_FLOOR + 17
const input = {columnFilters:{},groupBy:[],route:[],start:0,end:100,revision}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.access.mockResolvedValue(undefined)
  mocks.read.mockResolvedValue([{revision}])
  mocks.publication.mockResolvedValue({})
  mocks.ensure.mockResolvedValue({computedRevision:revision,computedAt:new Date(0)})
  mocks.fresh.mockReturnValue(true)
  mocks.settings.mockResolvedValue({})
  mocks.system.mockResolvedValue({})
})
it('keeps access, freshness and revision barriers without loading row-query settings', async () => {
  const identity = await journalReadIdentity(input,'joint')
  expect(identity.revision).toBe(revision)
  expect(mocks.access).toHaveBeenCalledWith('entry')
  expect(mocks.ensure).toHaveBeenCalledOnce()
  expect(mocks.read).toHaveBeenCalledTimes(2)
  expect(mocks.settings).not.toHaveBeenCalled()
  expect(mocks.system).not.toHaveBeenCalled()
  expect(mocks.where).not.toHaveBeenCalled()
  await assertJournalContextRevision(identity)
  expect(mocks.read).toHaveBeenCalledTimes(3)
})
it('still prepares row settings for actual grid reads', async () => {
  await journalReadContext(input)
  expect(mocks.settings).toHaveBeenCalledOnce()
  expect(mocks.system).toHaveBeenCalledOnce()
  expect(mocks.where).toHaveBeenCalledOnce()
})
it('rejects revoked access before reading any cached identity', async () => {
  mocks.access.mockRejectedValueOnce(new Error('denied'))
  await expect(journalReadIdentity(input)).rejects.toThrow('denied')
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.ensure).not.toHaveBeenCalled()
})
it('rejects an already stale client before refreshing the dispatcher', async () => {
  await expect(journalReadIdentity({...input,revision:revision-1})).rejects.toThrow('изменились')
  expect(mocks.ensure).not.toHaveBeenCalled()
})
it('rejects a dispatcher that remains stale after its freshness barrier', async () => {
  mocks.fresh.mockReturnValue(false)
  await expect(journalReadIdentity(input)).rejects.toThrow('изменились')
  expect(mocks.settings).not.toHaveBeenCalled()
})
it('rejects a revision changing during the dispatcher check', async () => {
  mocks.read.mockResolvedValueOnce([{revision}]).mockResolvedValue([{revision:revision+1}])
  await expect(journalReadIdentity(input)).rejects.toThrow('изменились')
})
it('rejects a task publication changing while the cached result is prepared', async () => {
  mocks.publication.mockResolvedValue({taskPublication:{activeComputedRevision:10}})
  const identity = await journalReadIdentity({...input,revision:undefined},'dispatcherTasks')
  mocks.publication.mockResolvedValue({taskPublication:{activeComputedRevision:11}})
  await expect(assertJournalContextRevision(identity)).rejects.toThrow('изменились')
})
