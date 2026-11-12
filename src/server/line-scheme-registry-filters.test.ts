import { expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { appSettings, lineSchemeBundles, lineSchemeMembers, weldJointProgramStates, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { readSchemeFilterOptions, readSchemeLines } from './line-scheme-read'

const slot = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('@/db', () => ({ requireDb: () => ({ transaction: (run: (db: unknown) => unknown) => run(slot.db) }) }))

function fixture(sizes: number[], placed = sizes) {
  const lines = sizes.map((_, index) => ({ line_id: index + 1, bundle_id: index + 1, project_title: 'P', subtitle_code: 'S', line: `L${index}`, deleted: false, file_name: 'Plan.pdf', revision_count: 2, matching: sizes.length }))
  let id = 0
  const rows: WeldRow[] = sizes.flatMap((size, index) => Array.from({ length: size }, () => {
    id++
    return { id, projectTitle: 'P', subtitleCode: 'S', line: `L${index}`, lineProgramId: index + 1, joint: `F${id}`,
      programChainState: { weldJointId: id, kind: 'primary', physicalRootId: id, sourceRowId: null, coilParentId: null, coilSide: null, replacedByCoil: false } }
  }))
  const tables: unknown[] = []
  const select = vi.fn(() => {
    let table: unknown
    const result = () => table === appSettings ? [] : table === weldJoints ? rows.map(row => ({ row, state: row.programChainState }))
      : table === weldJointProgramStates ? rows.map(row => row.programChainState)
      : table === lineSchemeMembers ? rows.map(row => ({ weldJointId: row.id, physicalId: row.id }))
      : table === lineSchemeBundles ? lines.map((line, index) => ({ bundleId: line.bundle_id, count: placed[index], activeCount: placed[index] })) : []
    const query: any = { from: (value: unknown) => { table = value; tables.push(value); return query }, where: () => query,
      innerJoin: () => query, leftJoin: () => query, groupBy: () => query, orderBy: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) }
    return query
  })
  const execute = vi.fn(async (_query: SQL) => ({ rows: lines as unknown[] }))
  slot.db = { select, execute }
  return { tables, select, execute }
}

it.each([1000, 200000])('filters %i physical joints before pagination with six batched reads', async count => {
  const db = fixture(Array(1000).fill(count / 1000))
  const result = await readSchemeLines({ page: 19, filters: { total: [String(count / 1000)], placedPercent: ['100'] } })
  expect(result.total).toBe(1000)
  expect(result.rows).toHaveLength(50)
  expect(result.rows[0].lineId).toBe(951)
  expect(db.tables).toEqual([appSettings, weldJoints, weldJointProgramStates, lineSchemeMembers, lineSchemeBundles])
  expect(db.execute).toHaveBeenCalledTimes(1)
  const query = new PgDialect().sqlToQuery(db.execute.mock.calls[0][0])
  expect(query.sql).not.toMatch(/limit|offset/i)
}, 20_000)

it('matches the rounded displayed percentage, keeps undefined distinct from zero and ignores its own facet', async () => {
  fixture([0, 2, 3, 3332], [0, 0, 1, 1110])
  expect(await readSchemeFilterOptions({ field: 'placedPercent', filters: { placedPercent: ['33.3'] } })).toEqual({ hasMore: false, options: [
    { value: '', label: '—', count: 1 }, { value: '0', label: '0%', count: 1 }, { value: '33.3', label: '33,3%', count: 2 },
  ] })
  const result = await readSchemeLines({ filters: { placedPercent: ['33.3'] } })
  expect(result.rows.map(row => row.lineId)).toEqual([3, 4])
  expect(await readSchemeFilterOptions({ field: 'pdf', filters: { placedPercent: ['33.3'] } })).toEqual({ hasMore: false, options: [{ value: 'Plan', label: 'Plan', count: 2 }] })
  expect((await readSchemeFilterOptions({ field: 'placedPercent', valueSearch: '33,3%' })).options).toHaveLength(1)
})

it('sorts physical counts numerically and respects other metric filters', async () => {
  fixture([10, 9, 0], [0, 0, 0])
  expect((await readSchemeFilterOptions({ field: 'total', filters: { placedPercent: ['0'] } })).options.map(option => option.value)).toEqual(['9', '10'])
})

it('keeps decimal tie rounding consistent with the table', async () => {
  fixture([2000], [51])
  expect((await readSchemeFilterOptions({ field: 'placedPercent' })).options).toEqual([{ value: '2.6', label: '2,6%', count: 1 }])
})

it('keeps metadata facets in one SQL read with all revisions counted and a bounded response', async () => {
  const db = fixture([])
  db.execute.mockResolvedValue({ rows: [{ value: 0, count: 30 }, { value: 2, count: 5 }, { value: 10, count: 1 }] })
  const result = await readSchemeFilterOptions({ field: 'files', filters: { pdf: ['Plan'] } })
  expect(result.options.map(option => [option.value, option.count])).toEqual([['0', 30], ['2', 5], ['10', 1]])
  expect(db.select).not.toHaveBeenCalled()
  expect(db.execute).toHaveBeenCalledTimes(1)
  const query = new PgDialect().sqlToQuery(db.execute.mock.calls[0][0])
  expect(query.sql).toContain('order by revision_count limit 101')
  expect(query.params).toContainEqual(['Plan'])
})

it('rejects malformed numeric filter input before reading any data', async () => {
  const db = fixture([])
  await expect(readSchemeLines({ filters: { total: [2] as never } })).rejects.toThrow('Недопустимые значения')
  expect(db.execute).not.toHaveBeenCalled()
  expect(db.select).not.toHaveBeenCalled()
})
