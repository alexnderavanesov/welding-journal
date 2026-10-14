import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { RepeatedJointTask } from '@/lib/dispatcher-types'

import {
  createDispatcherTaskIndexStageWriter,
  createDispatcherTaskPageStageWriter,
  DISPATCHER_TASK_INDEX_STAGE_BATCH_SIZE,
} from '@/server/dispatcher-task-index-staging'

describe('dispatcher task index staging', () => {
  it('keeps database requests bounded by fixed-size batches', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const writer = createDispatcherTaskIndexStageWriter({ execute }, 'active')
    const rowCount = DISPATCHER_TASK_INDEX_STAGE_BATCH_SIZE * 2 + 7
    const rows = Array.from({ length: rowCount }, (_, index) => ({
      rowId: index + 1,
      taskKey: `code:ДЗ-${index % 33}`,
      code: `ДЗ-${index % 33}`,
    }))

    await writer.append(rows)
    await writer.flush()

    expect(execute).toHaveBeenCalledTimes(3)
    const batches = execute.mock.calls.map(([query]) => new PgDialect().sqlToQuery(query))
    expect(batches.map(batch => batch.params[0])).toEqual([
      rows.slice(0, DISPATCHER_TASK_INDEX_STAGE_BATCH_SIZE).map(row => row.rowId),
      rows.slice(DISPATCHER_TASK_INDEX_STAGE_BATCH_SIZE, DISPATCHER_TASK_INDEX_STAGE_BATCH_SIZE * 2).map(row => row.rowId),
      rows.slice(DISPATCHER_TASK_INDEX_STAGE_BATCH_SIZE * 2).map(row => row.rowId),
    ])
    const restored = batches.flatMap(batch => (batch.params[0] as number[]).map((rowId, i) => ({
      rowId, taskKey: (batch.params[1] as string[])[i], code: (batch.params[2] as string[])[i],
    })))
    expect(restored).toEqual(rows)
    expect(writer.getMetrics()).toEqual({
      insertedRowCount: rowCount,
      insertRequestCount: 3,
      pendingRowCount: 0,
    })
  })

  it('preserves paired values and duplicates without interpolating text into SQL', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const writer = createDispatcherTaskIndexStageWriter({ execute }, 'background')
    const rows = [
      { rowId: 1, taskKey: 'quote"\\{comma,}\nNULL', code: 'СП-01' },
      { rowId: 1, taskKey: 'quote"\\{comma,}\nNULL', code: 'СП-01' },
      { rowId: 2, taskKey: '', code: '' },
    ]
    await writer.append([])
    await writer.flush()
    expect(execute).not.toHaveBeenCalled()
    await writer.append(rows.slice(0, 1))
    await writer.append(rows.slice(1))
    await writer.flush()
    await writer.flush()
    expect(execute).toHaveBeenCalledTimes(1)
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
    expect(query.sql).toContain('unnest(')
    expect(query.sql).not.toContain(rows[0].taskKey)
    expect(query.params).toEqual([rows.map(row => row.rowId), rows.map(row => row.taskKey), rows.map(row => row.code)])
  })

  it('stores task-card pages in bounded batches and keeps every task beyond 5,000', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const writer = createDispatcherTaskPageStageWriter({ execute })
    const tasks = Array.from({ length: 5_101 }, (_, index) => ({ key: `task-${index + 1}` })) as RepeatedJointTask[]

    await writer.append('scope-a', tasks.slice(0, 3_000))
    await writer.append('scope-a', tasks.slice(3_000))
    await writer.flush()

    expect(writer.getMetrics()).toEqual({ pageCount: 52, taskCount: 5_101, insertRequestCount: 2, pendingTaskCount: 0 })
    expect(execute).toHaveBeenCalledTimes(2)
    const firstBatch = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
    const lastBatch = new PgDialect().sqlToQuery(execute.mock.calls[1][0])
    expect(firstBatch.params[0]).toHaveLength(50)
    expect(lastBatch.params[0]).toEqual(['scope-a', 'scope-a'])
    expect(lastBatch.params[1]).toEqual([51, 52])
    expect(lastBatch.params[2]).toEqual([100, 1])
    expect(JSON.parse((lastBatch.params[3] as string[])[1])).toEqual([{ key: 'task-5101' }])
  })

  it('starts a separate page range for every line and keeps a partial final page', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const writer = createDispatcherTaskPageStageWriter({ execute })
    const tasks = Array.from({ length: 101 }, (_, index) => ({ key: `task-${index}` })) as RepeatedJointTask[]
    await writer.append('old-line', tasks)
    await writer.append('new-line', tasks.slice(0, 1))
    await writer.flush()

    expect(writer.getMetrics()).toEqual({ pageCount: 3, taskCount: 102, insertRequestCount: 1, pendingTaskCount: 0 })
    const batch = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
    expect(batch.params[0]).toEqual(['old-line', 'old-line', 'new-line'])
    expect(batch.params[1]).toEqual([1, 2, 1])
    expect(batch.params[2]).toEqual([100, 1, 1])
  })
})
