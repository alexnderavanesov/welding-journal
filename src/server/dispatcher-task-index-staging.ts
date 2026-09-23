import { sql, type SQL } from 'drizzle-orm'

import type { DispatcherTaskIndexRow } from '@/lib/dispatcher-task-row-codes'
import type { RepeatedJointTask } from '@/lib/dispatcher-types'
import { DISPATCHER_TASK_PAGE_SIZE } from '@/lib/dispatcher-task-index-payload'

export const DISPATCHER_TASK_INDEX_STAGE_BATCH_SIZE = 50_000
const DISPATCHER_TASK_PAGE_WRITE_BATCH_SIZE = 50

export type DispatcherTaskIndexStageName = 'active' | 'background'

type StageExecutor = {
  execute: (query: SQL) => PromiseLike<unknown>
}

export async function createDispatcherTaskIndexStage(
  executor: StageExecutor,
  name: DispatcherTaskIndexStageName,
) {
  const stage = getDispatcherTaskIndexStageTable(name)
  await executor.execute(sql`
    create temporary table ${stage} (
      "weld_joint_id" integer not null,
      "task_key" text not null,
      "code" text not null
    ) on commit drop
  `)
}

export function createDispatcherTaskIndexStageWriter(
  executor: StageExecutor,
  name: DispatcherTaskIndexStageName,
) {
  const pendingRows: DispatcherTaskIndexRow[] = []
  let insertedRowCount = 0
  let insertRequestCount = 0

  const writeChunk = async (chunk: DispatcherTaskIndexRow[]) => {
    if (chunk.length === 0) return
    const payload = JSON.stringify(chunk.map((row) => ({
      weldJointId: row.rowId,
      taskKey: row.taskKey,
      code: row.code,
    })))
    const stage = getDispatcherTaskIndexStageTable(name)
    await executor.execute(sql`
      insert into ${stage} ("weld_joint_id", "task_key", "code")
      select
        "rows"."weldJointId",
        "rows"."taskKey",
        "rows"."code"
      from jsonb_to_recordset(${payload}::jsonb) as "rows"(
        "weldJointId" integer,
        "taskKey" text,
        "code" text
      )
    `)
    insertedRowCount += chunk.length
    insertRequestCount += 1
  }

  const append = async (rows: DispatcherTaskIndexRow[]) => {
    for (const row of rows) {
      pendingRows.push(row)
      if (pendingRows.length >= DISPATCHER_TASK_INDEX_STAGE_BATCH_SIZE) {
        await writeChunk(pendingRows.splice(0, DISPATCHER_TASK_INDEX_STAGE_BATCH_SIZE))
      }
    }
  }

  const flush = async () => {
    while (pendingRows.length > 0) {
      await writeChunk(pendingRows.splice(0, DISPATCHER_TASK_INDEX_STAGE_BATCH_SIZE))
    }
  }

  const getMetrics = () => ({
    insertedRowCount,
    insertRequestCount,
    pendingRowCount: pendingRows.length,
  })

  return { append, flush, getMetrics }
}

export function getDispatcherTaskIndexStageTable(name: DispatcherTaskIndexStageName) {
  return name === 'active'
    ? sql.raw('pg_temp."dispatcher_task_index_stage"')
    : sql.raw('pg_temp."dispatcher_background_task_index_stage"')
}

export function getDispatcherTaskPageStageTable() {
  return sql.raw('pg_temp."dispatcher_task_page_stage"')
}

export async function createDispatcherTaskPageStage(executor: StageExecutor) {
  const stage = getDispatcherTaskPageStageTable()
  await executor.execute(sql`
    create temporary table ${stage} (
      "scope_key" text not null,
      "page_number" integer not null,
      "task_count" integer not null,
      "tasks" text not null,
      primary key ("scope_key", "page_number")
    ) on commit drop
  `)
}

export function createDispatcherTaskPageStageWriter(executor: StageExecutor) {
  const pendingTasks: RepeatedJointTask[] = []
  const pendingPages: Array<{ scopeKey: string; pageNumber: number; taskCount: number; tasks: string }> = []
  let currentScopeKey: string | null = null
  let nextScopePageNumber = 1
  let totalPageCount = 0
  let totalTaskCount = 0
  let insertRequestCount = 0

  const writePages = async () => {
    if (pendingPages.length === 0) return
    const pages = pendingPages.splice(0, pendingPages.length)
    const stage = getDispatcherTaskPageStageTable()
    await executor.execute(sql`
      insert into ${stage} ("scope_key", "page_number", "task_count", "tasks")
      select source.scope_key, source.page_number, source.task_count, source.tasks
      from unnest(
        ${sql.param(pages.map((page) => page.scopeKey))}::text[],
        ${sql.param(pages.map((page) => page.pageNumber))}::integer[],
        ${sql.param(pages.map((page) => page.taskCount))}::integer[],
        ${sql.param(pages.map((page) => page.tasks))}::text[]
      ) as source(scope_key, page_number, task_count, tasks)
    `)
    insertRequestCount += 1
  }

  const completePage = async () => {
    if (pendingTasks.length === 0) return
    const tasks = pendingTasks.splice(0, DISPATCHER_TASK_PAGE_SIZE)
    pendingPages.push({
      scopeKey: currentScopeKey!,
      pageNumber: nextScopePageNumber++,
      taskCount: tasks.length,
      tasks: JSON.stringify(tasks),
    })
    totalPageCount += 1
    if (pendingPages.length >= DISPATCHER_TASK_PAGE_WRITE_BATCH_SIZE) await writePages()
  }

  const append = async (scopeKey: string, tasks: readonly RepeatedJointTask[]) => {
    if (currentScopeKey !== scopeKey) {
      await completePage()
      currentScopeKey = scopeKey
      nextScopePageNumber = 1
    }
    for (const task of tasks) {
      pendingTasks.push(task)
      totalTaskCount += 1
      if (pendingTasks.length >= DISPATCHER_TASK_PAGE_SIZE) await completePage()
    }
  }

  const flush = async () => {
    await completePage()
    await writePages()
  }

  const getMetrics = () => ({
    pageCount: totalPageCount,
    taskCount: totalTaskCount,
    insertRequestCount,
    pendingTaskCount: pendingTasks.length,
  })

  return { append, flush, getMetrics }
}
