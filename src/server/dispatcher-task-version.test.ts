import { expect, it, vi } from 'vitest'
import { readDispatcherTaskVersion } from './dispatcher-task-version'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

it.each([undefined, { sourceRevision: 44, computedRevision: 43, computedAt: new Date('2026-10-08T12:00:00Z') }])('reads exactly three scalar columns from id=1 without initialization or recalculation', async state => {
  const limit = vi.fn(async () => state ? [state] : [])
  const where = vi.fn((_condition: SQL) => ({ limit }))
  const from = vi.fn(() => ({ where }))
  const select = vi.fn((_columns: Record<string, unknown>) => ({ from }))
  const result = await readDispatcherTaskVersion({ select } as never)
  expect(select).toHaveBeenCalledOnce()
  expect(Object.keys(select.mock.calls[0]?.[0] ?? {})).toEqual(['sourceRevision', 'computedRevision', 'computedAt'])
  expect(limit).toHaveBeenCalledExactlyOnceWith(1)
  const condition = new PgDialect().sqlToQuery(where.mock.calls[0]![0] as SQL)
  expect(condition.sql).toContain('"dispatcher_task_index_state"."id"')
  expect(condition.params).toEqual([1])
  expect(result.sourceRevision).toBe(state?.sourceRevision ?? -1)
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(300)
})
