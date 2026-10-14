import { expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { duplicateControls, preHeatTreatmentControls, pstoRepeatCycles, weldJoints } from '@/db/schema'
import { createDispatcherRuleFixtures } from '@/test/dispatcher-rule-fixtures'
import type { WeldRow } from '@/lib/dispatcher-types'
import { calculateFullDispatcherTasks } from './dispatcher-task-index'
import { DISPATCHER_WELD_WORKING_SET_SIZE, getDispatcherScopeKey, visitDispatcherWeldRows } from './dispatcher-weld-rows'

vi.mock('./dispatcher-weld-hydration', () => ({
  readDispatcherWeldBatch: async (db: { readBatch: (ids: number[]) => Promise<unknown[]> }, ids: number[]) => db.readBatch(ids),
}))

vi.mock('./dispatcher-weld-rows', async importOriginal => {
  const original = await importOriginal<typeof import('./dispatcher-weld-rows')>()
  return { ...original, visitDispatcherWeldRows: vi.fn(original.visitDispatcherWeldRows) }
})

it('keeps full-calculation tasks, publication order, chains and statuses identical across complete-line batches', async () => {
  const rows: WeldRow[] = [
    ...Array.from({ length: DISPATCHER_WELD_WORKING_SET_SIZE }, (_, i) => ({ id: 100_000 + i, projectTitle: '! padding', line: 'L', joint: `F${i}`, officiality: 'неофициальный' })),
    ...createDispatcherRuleFixtures().flatMap(fixture => fixture.rows),
    { id: 20_001, projectTitle: 'Same name', line: 'L 1', joint: 'F1', officiality: 'неофициальный', vikResult: 'ремонт' },
    { id: 20_002, projectTitle: 'Same name', line: 'L1', joint: 'F1', officiality: 'действующий' },
  ]
  const relations = new Map<unknown, Array<Record<string, unknown>>>([
    [duplicateControls, [{ id: 1, weldJointId: 101, method: 'РК', result: 'вырез', conclusion: 'ДУБЛЬ', controlDate: '2026-07-02' }]],
    [preHeatTreatmentControls, [{ id: 1, weldJointId: 102, method: 'ВИК', result: 'ремонт' }]],
    [pstoRepeatCycles, [{ id: 1, weldJointId: 101, sequence: 2, pstoResult: 'проведено', tvmtResult: 'ожидает НК' }]],
  ])
  const select = (columns?: unknown) => ({ from: (table: unknown) => {
    const all = table === weldJoints ? rows : relations.get(table) ?? []
    const clone = (items: unknown[]) => structuredClone(items)
    return Object.assign(Promise.resolve(clone(all)), {
      orderBy: async () => table === weldJoints && columns
        ? rows.map(({ id, projectTitle, subtitleCode, line }) => ({ id, projectTitle, subtitleCode, line })) : clone(all),
      where: (condition: Parameters<PgDialect['sqlToQuery']>[0]) => {
        const ids = new PgDialect().sqlToQuery(condition).params[0] as number[]
        const selected = clone(all.filter(row => ids.includes(Number(table === weldJoints ? row.id : row.weldJointId))))
        return Object.assign(Promise.resolve(selected), { orderBy: async () => selected })
      },
    })
  } })
  const run = async () => {
    const index: unknown[] = [], pages: unknown[] = []
    const readBatch = async (ids: number[]) => structuredClone(rows.filter(row => ids.includes(row.id)))
    const result = await calculateFullDispatcherTasks({ select, readBatch } as never, {
      taskSnapshotLimit: 100,
      onTaskIndexRows: value => { index.push(...value) },
      onTaskPageRows: (scope, value) => { pages.push({ scope, value }) },
    })
    return { ...result, sourceRows: result.sourceRows.sort((a, b) => a.id - b.id),
      preparedRows: result.preparedRows.sort((a, b) => a.id - b.id), index, pages }
  }
  const actual = await run()
  // Reference: the former all-at-once journal working set. The rule functions
  // are deliberately the same; this regression targets partitioning, not rules.
  vi.mocked(visitDispatcherWeldRows).mockImplementationOnce(async (_db, visit) => {
    await visit(structuredClone(rows) as never, new Set(rows.map(getDispatcherScopeKey)))
  })
  expect(actual).toEqual(await run())
  expect(actual.preparedRows.find(row => row.id === 20_002)?.finalStatus).toBe('ожидает ремонт')
  expect(actual.preparedRows).toHaveLength(rows.length)
}, 20_000)
