import { expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { normalizeOtherSettings } from '@/lib/other-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'

const mock = vi.hoisted(() => ({ live: { wdi: 20 }, projection: vi.fn() }))
function database(wdi: number) {
  const chain = {
    from: () => chain, where: () => chain, groupBy: () => chain,
    orderBy: () => chain, limit: () => chain,
    offset: async () => [{ key: 'L', childCount: 1, recordCount: 1, total: 1 }],
  }
  return { wdi, select: () => chain, execute: vi.fn() }
}
vi.mock('@/db', () => ({ requireDb: () => database(mock.live.wdi) }))
vi.mock('./journal-summary-hydration', () => ({ readJournalSummaryProjection: mock.projection }))
import { readJournalPage, type JournalReadContext } from './journal-grid'

function context(revision: number, snapshot?: ReturnType<typeof database>): JournalReadContext {
  return {
    request: { report: 'weldingJournal', columnFilters: {}, groupBy: ['line'], route: [], start: 0, end: 100, sort: null },
    revision, db: snapshot as unknown as JournalReadContext['db'],
    dispatcher: { repeatedTasks: '[]' } as JournalReadContext['dispatcher'],
    settings: normalizeOtherSettings({ wdiCalculationMode: 'manual' }),
    systemSettings: DEFAULT_SYSTEM_INDEX_SETTINGS, base: sql`true`, where: sql`true`,
  }
}
mock.projection.mockImplementation(async (db: { wdi: number }) => [{
  row: { id: 1, joint: 'F1', line: 'L', groupKey: 'L', wdi: db.wdi, finalStatus: 'годен' },
  state: { weldJointId: 1, kind: 'primary', physicalRootId: 1 },
  root: { id: 1, wdi: db.wdi }, rootState: { replaced: false },
}])

it('does not publish an unpinned range read into the cache of an older repeatable-read snapshot', async () => {
  // A copy/range request captured revision 101, then another writer committed
  // WDI 20. Its eventual revision check will reject it. A concurrent grid
  // transaction still legitimately sees revision 101 and WDI 10.
  const liveRange = await readJournalPage(context(101))
  expect(liveRange.rows[0].journalGroup?.summary.wdi).toBe(20)
  const pinnedGrid = await readJournalPage(context(101, database(10)))
  expect(pinnedGrid.rows[0].journalGroup?.summary.wdi).toBe(10)
})

it('still reuses a small summary across sorting and added child grouping inside checked snapshots', async () => {
  mock.projection.mockClear()
  const first = context(102, database(10))
  const result = await readJournalPage(first)
  const second = await readJournalPage({ ...first, request: { ...first.request,
    groupBy: ['line', 'joint'], sort: { fieldKey: 'line', direction: 'desc' } } })
  expect(second.rows[0].journalGroup?.summary).toEqual(result.rows[0].journalGroup?.summary)
  expect(mock.projection).toHaveBeenCalledOnce()
})
