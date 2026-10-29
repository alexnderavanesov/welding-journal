import { beforeEach, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import { DERIVED_CALCULATION_REVISION_FLOOR } from '@/lib/derived-calculation-cache-version'

const mock = vi.hoisted(() => ({ members: [] as any[], extras: [] as any[], reads: vi.fn(), revisions: vi.fn(), access: vi.fn(), ensure: vi.fn(), fresh: vi.fn(), settings: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ select: (projection: Record<string, unknown>) => {
  const chain = { from: () => chain, leftJoin: () => chain, where: async (where: unknown) => {
    if ('revision' in projection) return mock.revisions()
    mock.reads(projection, where)
    return mock.reads.mock.calls.length === 1 ? mock.members : mock.extras
  } }
  return chain
} }) }))
vi.mock('./security-functions', () => ({ assertSecurityScope: mock.access }))
vi.mock('./report-task-publication-cache-key', () => ({ getReportTaskPublicationCacheIdentity: async () => ({}) }))
vi.mock('./dispatcher-task-index', async original => ({ ...await original<typeof import('./dispatcher-task-index')>(), ensureDispatcherTaskIndexFresh: mock.ensure, isDispatcherTaskIndexFresh: mock.fresh }))
vi.mock('./weld-server-shared', async original => ({ ...await original<typeof import('./weld-server-shared')>(), loadServerOtherSettings: mock.settings }))
vi.mock('./line-program', async original => ({ ...await original<typeof import('./line-program')>(), loadProgramSystemIndexSettings: async () => DEFAULT_SYSTEM_INDEX_SETTINGS }))
vi.mock('./weld-read', async original => ({ ...await original<typeof import('./weld-read')>(), buildReportQueryWhere: () => sql`true` }))
import { summarizeJournalGridSelection } from './journal-grid'

const revision = DERIVED_CALCULATION_REVISION_FLOOR + 17
function record(id: number, rootId = id, options = {}) {
  return { row: { id, joint: `S${id}`, line: 'L', projectTitle: 'P', subtitleCode: 'C', finalStatus: 'годен', weldDate: '2026-09-01', wdi: 99 },
    state: { weldJointId: id, kind: id === rootId ? 'primary' : 'repair', physicalRootId: rootId, sourceRowId: id === rootId ? null : rootId, replacedByCoil: false },
    root: { id: rootId, wdi: 10, d1: 254, connectionType: 'С17' }, replaced: false, ...options }
}
beforeEach(() => {
  vi.clearAllMocks(); mock.members = []; mock.extras = []
  mock.revisions.mockResolvedValue([{ revision }]); mock.access.mockResolvedValue(undefined)
  mock.ensure.mockResolvedValue({ repeatedTasks: '{}' }); mock.fresh.mockReturnValue(true)
  mock.settings.mockResolvedValue({ ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'manual' })
})
it('deduplicates repairs, ignores replaced roots and counts selected history dates with missing values explicitly', async () => {
  const first = record(1), repair = record(2, 1), replaced = record(3, 3, { replaced: true }), unknown = record(4, 4, { root: { id: 4, wdi: null } })
  repair.row.weldDate = '2026-09-05'; unknown.row.weldDate = ''
  mock.members = [first, repair, replaced, unknown]
  expect(await summarizeJournalGridSelection({ ids: [1, 2, 3, 4, 2] })).toEqual({ records: 4, joints: 2, wdi: 10, missingWdi: 1, weldDate: '01.09.2026 — 05.09.2026', missingDates: 1 })
  expect(mock.access).toHaveBeenCalledWith('entry')
})
it.each([1, 200000])('uses one narrow joined data query for %i selected IDs and returns only totals', async count => {
  mock.members = Array.from({ length: count }, (_, i) => record(i + 1))
  const result = await summarizeJournalGridSelection({ ids: mock.members.map(({ row }) => row.id) })
  expect(result).toMatchObject({ records: count, joints: count, wdi: count * 10 })
  expect(mock.reads).toHaveBeenCalledOnce()
  expect(mock.revisions).toHaveBeenCalledTimes(2)
  const [projection, where] = mock.reads.mock.calls[0]
  expect(Object.keys(projection.row)).not.toContain('rowVersion')
  const query = new PgDialect().sqlToQuery(where)
  expect(query.sql).toContain('any(')
  expect(query.params).toHaveLength(1)
  expect(JSON.stringify(result).length).toBeLessThan(200)
}, 20000)
it('calculates current root WDI even when only a hidden-root repair is selected', async () => {
  mock.settings.mockResolvedValue({ ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula' })
  mock.members = [record(2, 1, { root: { id: 1, wdi: 999, d1: 508, connectionType: 'С17' } })]
  expect(await summarizeJournalGridSelection({ ids: [2] })).toMatchObject({ joints: 1, wdi: 20 })
})
it('refuses missing IDs, stale results, denied access and cancelled work', async () => {
  await expect(summarizeJournalGridSelection({ ids: [1] })).rejects.toThrow('удалена или недоступна')
  mock.reads.mockClear()
  mock.members = [record(1)]
  mock.revisions.mockResolvedValueOnce([{ revision }]).mockResolvedValueOnce([{ revision: revision + 1 }])
  await expect(summarizeJournalGridSelection({ ids: [1] })).rejects.toThrow('изменились')
  mock.access.mockRejectedValueOnce(new Error('denied'))
  await expect(summarizeJournalGridSelection({ ids: [1] })).rejects.toThrow('denied')
  await expect(summarizeJournalGridSelection({ ids: [1] }, AbortSignal.abort())).rejects.toThrow()
  await expect(summarizeJournalGridSelection({ ids: [-1] })).rejects.toThrow('Некорректный')
})

it('rejects an expired displayed snapshot before rebuilding the dispatcher or reading selected rows', async () => {
  await expect(summarizeJournalGridSelection({ ids: [1], snapshot: { revision: revision - 1, columnFilters: { search: 'old view' } } })).rejects.toThrow('изменились')
  expect(mock.access).toHaveBeenCalledWith('entry')
  expect(mock.ensure).not.toHaveBeenCalled()
  expect(mock.settings).not.toHaveBeenCalled()
  expect(mock.reads).not.toHaveBeenCalled()
})

it('still refuses a concurrent mutation after a pinned selection has been read', async () => {
  mock.members = [record(1)]
  mock.revisions.mockResolvedValueOnce([{ revision }]).mockResolvedValueOnce([{ revision }])
    .mockResolvedValueOnce([{ revision }]).mockResolvedValueOnce([{ revision: revision + 1 }])
  await expect(summarizeJournalGridSelection({ ids: [1], snapshot: { revision, columnFilters: {} } })).rejects.toThrow('изменились')
  expect(mock.reads).toHaveBeenCalledOnce()
})
