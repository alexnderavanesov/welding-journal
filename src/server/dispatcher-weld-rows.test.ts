import { expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { DISPATCHER_WELD_READ_BATCH_SIZE, DISPATCHER_WELD_WORKING_SET_SIZE, getDispatcherScopeKey, planDispatcherWeldBatches, visitDispatcherWeldRows } from './dispatcher-weld-rows'
import { prepareReportRowsInPlace } from '@/lib/use-report-rows'

it('plans 200k joints as ten whole-line working sets with small hydration reads, not per-joint queries', () => {
  const rows = Array.from({ length: 200_000 }, (_, i) => ({ id: i + 1,
    projectTitle: 'P', subtitleCode: 'S', line: `L${Math.floor(i / 200)}` }))
  const { batches, contexts } = planDispatcherWeldBatches(rows)
  expect(batches).toHaveLength(10)
  expect(batches.every(batch => batch.length === 100 && batch.every(scope => scope.ids.length === 200))).toBe(true)
  expect(contexts.size).toBe(1000)
  expect(new Set(batches.flatMap(batch => batch.flatMap(scope => scope.ids))).size).toBe(200_000)
})

it.each([0, 1, 5_000, 10_001])('hydrates %i wide rows in sequential bounded reads without changing order or values', async count => {
  // Deliberately neither ID nor locale order: only PostgreSQL defines the order.
  const ordered = Array.from({ length: count }, (_, i) => ({ id: count - i, line: (count - i) % 2 ? 'A' : null }))
  const createdAt = new Date('2026-09-01T00:00:00Z')
  const originals = new Map(ordered.map(({ id }) => [id, { id, joint: ` F${id} `, createdAt, d1: 57.2,
    technologyCardNumber: 'ТК  №1', line: id % 2 ? 'A' : null, layeredControlAssigned: false }]))
  const batches: number[][] = []
  let active = 0, peak = 0
  const select = vi.fn((columns?: unknown) => ({ from: () => columns ? {
    orderBy: vi.fn(async () => ordered),
  } : {
    where: async (condition: Parameters<PgDialect['sqlToQuery']>[0]) => {
      const query = new PgDialect().sqlToQuery(condition)
      const ids = query.params[0] as number[]
      batches.push(ids); peak = Math.max(peak, ++active)
      await Promise.resolve(); active--
      return ids.slice().reverse().map(id => originals.get(id))
    },
  } }))
  const rows: Array<NonNullable<ReturnType<typeof originals.get>>> = []
  await visitDispatcherWeldRows({ select } as never, async batch => { rows.push(...batch as unknown as typeof rows) })
  const expected = ordered.map(({ id }) => originals.get(id)!).sort((a, b) => getDispatcherScopeKey(a) < getDispatcherScopeKey(b) ? -1 : getDispatcherScopeKey(a) > getDispatcherScopeKey(b) ? 1 : 0)
  expect(rows).toEqual(expected)
  expect(select).toHaveBeenCalledTimes(1 + Math.ceil(count / DISPATCHER_WELD_READ_BATCH_SIZE))
  expect(batches.every(batch => batch.length <= DISPATCHER_WELD_READ_BATCH_SIZE)).toBe(true)
  expect(peak).toBe(count ? 1 : 0)
  for (const row of rows) {
    expect(row).not.toBe(originals.get(row.id))
    expect(row.createdAt).toBe(createdAt) // no lossy JSON/string conversion
  }
})

it('includes whitespace-equivalent final-status neighbours across batch boundaries without merging task scopes', async () => {
  const source = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L 1', joint: 'F1', officiality: 'неофициальный', vikResult: 'ремонт' }
  const target = { id: 2, projectTitle: 'P', subtitleCode: 'S', line: 'L1', joint: 'F1', officiality: 'действующий' }
  const rows = [source, target, ...Array.from({ length: DISPATCHER_WELD_WORKING_SET_SIZE - 1 }, (_, i) => ({ ...target, id: i + 3, joint: `F${i + 2}` }))]
  const plan = planDispatcherWeldBatches(rows)
  expect(plan.batches).toHaveLength(2)
  expect(plan.contexts.size).toBe(1)
  const byId = new Map(rows.map(row => [row.id, row]))
  const select = vi.fn((columns?: unknown) => ({ from: () => columns ? { orderBy: async () => rows } : {
    where: async (condition: Parameters<PgDialect['sqlToQuery']>[0]) =>
      (new PgDialect().sqlToQuery(condition).params[0] as number[]).map(id => ({ ...byId.get(id) })),
  } }))
  const statuses = new Map<number, unknown>(), published: number[] = []
  await visitDispatcherWeldRows({ select } as never, async (batch, scopeKeys) => {
    expect(batch).toHaveLength(DISPATCHER_WELD_WORKING_SET_SIZE + 1) // complete status context in both batches
    for (const row of prepareReportRowsInPlace(batch)) if (scopeKeys.has(getDispatcherScopeKey(row))) {
      statuses.set(row.id, row.finalStatus); published.push(row.id)
    }
  })
  expect(statuses.get(target.id)).toBe('ожидает ремонт')
  expect(published).toHaveLength(DISPATCHER_WELD_WORKING_SET_SIZE + 1)
  expect(new Set(published).size).toBe(DISPATCHER_WELD_WORKING_SET_SIZE + 1)
  expect(select).toHaveBeenCalledTimes(11) // identity + five 5k hydration reads per complete context
})
