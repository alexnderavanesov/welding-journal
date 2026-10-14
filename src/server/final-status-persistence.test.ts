import { expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { FINAL_STATUS_UPDATE_BATCH_SIZE, persistCalculatedFinalStatuses } from './final-status-persistence'

it('writes only changed statuses in bounded batches, preserving expected old values and nulls', async () => {
  const execute = vi.fn().mockResolvedValue(undefined)
  const previous = Array.from({ length: FINAL_STATUS_UPDATE_BATCH_SIZE * 2 + 5 }, (_, i) => ({ id: i + 1, finalStatus: i % 2 ? 'ожидает НК' : null }))
  const next = previous.map(row => ({ id: row.id, finalStatus: row.finalStatus === null ? 'годен' : null }))
  expect(await persistCalculatedFinalStatuses({ execute }, previous, next)).toBe(next.length)
  expect(execute).toHaveBeenCalledTimes(3)
  const chunks = execute.mock.calls.map(([query]) => new PgDialect().sqlToQuery(query))
  expect(chunks.map(chunk => (chunk.params[0] as number[]).length)).toEqual([FINAL_STATUS_UPDATE_BATCH_SIZE, FINAL_STATUS_UPDATE_BATCH_SIZE, 5])
  expect(chunks.flatMap(chunk => chunk.params[0] as number[])).toEqual(next.map(row => row.id))
  expect(chunks.flatMap(chunk => chunk.params[1] as unknown[])).toEqual(previous.map(row => row.finalStatus))
  expect(chunks.flatMap(chunk => chunk.params[2] as unknown[])).toEqual(next.map(row => row.finalStatus))
  for (const chunk of chunks) {
    expect(chunk.sql).toContain('is not distinct from "changes"."previous_final_status"')
    expect(chunk.sql).toContain('unnest(')
    expect(chunk.params).toHaveLength(3)
  }
})

it('does not update unchanged or missing source rows, including reordered input', async () => {
  const execute = vi.fn().mockResolvedValue(undefined)
  expect(await persistCalculatedFinalStatuses({ execute }, [{ id: 1 }], [{ id: 1, finalStatus: null }])).toBe(0)
  expect(execute).not.toHaveBeenCalled()
  expect(await persistCalculatedFinalStatuses({ execute }, [{ id: 1, finalStatus: 'годен' }, { id: 2 }],
    [{ id: 3, finalStatus: 'ремонт' }, { id: 2, finalStatus: 'ожидает НК' }, { id: 1, finalStatus: 'годен' }])).toBe(1)
  expect(new PgDialect().sqlToQuery(execute.mock.calls[0][0]).params).toEqual([[2], [null], ['ожидает НК']])
})
