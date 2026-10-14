import { expect, it, vi } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { weldJoints } from '@/db/schema'
import { readDispatcherWeldBatch } from './dispatcher-weld-hydration'

it('selects all schema columns under their exact keys and preserves the schema decoders', async () => {
  const columns = getTableColumns(weldJoints)
  const raw: Record<string, unknown> = Object.fromEntries(Object.keys(columns).map(key => [key, null]))
  Object.assign(raw, { id: 7, weldDate: '0001-01-02', d1: '123.456', d2: '0.000',
    createdAt: '2026-10-13 23:59:58.123456+03', preHeatTreatmentLnkExempt: false,
    joint: ' S01R1 ', boq: 'text not used by predicates but retained by task actions' })
  const expected = { ...raw, d1: 123.456, d2: 0, createdAt: new Date('2026-10-13T20:59:58.123Z') }
  const execute = vi.fn().mockResolvedValue({ rows: [raw] })
  const result = await readDispatcherWeldBatch({ execute } as never, [7])
  expect(result[0]).toEqual(expected)
  expect(result[0].weldDate).toBe('0001-01-02')
  expect(Object.keys(result[0])).toEqual(Object.keys(columns))
  const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
  expect(query.params).toEqual([[7]])
  for (const [key, column] of Object.entries(columns)) {
    expect(query.sql).toContain(`"${column.name}" as "${key}"`)
  }
  expect(query.sql).not.toContain('text not used')
})

it('does not read an empty batch or reuse an earlier response', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [] })
  expect(await readDispatcherWeldBatch({ execute } as never, [])).toEqual([])
  expect(execute).not.toHaveBeenCalled()
  expect(await readDispatcherWeldBatch({ execute } as never, [1])).toEqual([])
  expect(await readDispatcherWeldBatch({ execute } as never, [1])).toEqual([])
  expect(execute).toHaveBeenCalledTimes(2)
})
