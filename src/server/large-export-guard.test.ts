import { expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { createLargeExportGuard, LargeExportBusyError, LARGE_EXPORT_LOCK } from './large-export-guard'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

function guard(columns = 10, acquired = true, signal = new AbortController().signal) {
  const execute = vi.fn(async (_query: SQL) => ({ rows: [{ acquired }] }))
  const reserve = createLargeExportGuard({ execute } as unknown as SystemDocumentSequenceTransaction, columns, signal)
  return { reserve, execute }
}

it('keeps small/narrow and exact-boundary exports independent of the global slot', async () => {
  for (const columns of [1, 100]) {
    const { reserve, execute } = guard(columns, false)
    await reserve(0); await reserve(10_000)
    expect(execute).not.toHaveBeenCalled()
  }
})

it.each([{ rows: 10_001, columns: 1 }, { rows: 9346, columns: 107 }])('guards large rows or cells once: $rows × $columns', async ({ rows, columns }) => {
  const { reserve, execute } = guard(columns)
  await reserve(rows); await reserve(rows + 1000)
  expect(execute).toHaveBeenCalledTimes(1)
  const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
  expect(query.sql).toContain('pg_try_advisory_xact_lock')
  expect(query.params).toEqual([...LARGE_EXPORT_LOCK])
})

it('rejects a second large export without waiting, but accepts a small one', async () => {
  const { reserve, execute } = guard(107, false)
  await reserve(1000)
  await expect(reserve(200_000)).rejects.toBeInstanceOf(LargeExportBusyError)
  expect(execute).toHaveBeenCalledTimes(1)
})

it('upgrades a report expanded into more output rows before crossing the bound', async () => {
  const { reserve, execute } = guard(10, false)
  await reserve(2000); await reserve(10_000)
  await expect(reserve(12_000)).rejects.toBeInstanceOf(LargeExportBusyError)
  expect(execute).toHaveBeenCalledTimes(1)
})

it('does no work after cancellation, including after acquisition', async () => {
  const controller = new AbortController(), { reserve, execute } = guard(10, true, controller.signal)
  await reserve(20_000)
  controller.abort()
  await expect(reserve(21_000)).rejects.toThrow()
  expect(execute).toHaveBeenCalledTimes(1)
})
