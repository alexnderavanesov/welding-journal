import { createServerFn } from '@tanstack/react-start'
import { sql } from 'drizzle-orm'

import { requireDb } from '@/db'
import { dispatcherTaskIndexState, dispatcherTaskPages } from '@/db/schema'
import type { RepeatedJointTask } from '@/lib/dispatcher-types'
import { matchesDispatcherWorkspaceTask } from '@/lib/dispatcher-workspace-search'
import { DISPATCHER_INDEX_STATE_ID } from '@/server/dispatcher-task-index-constants'
import { assertSecurityScope } from '@/server/security-functions'

type DispatcherTaskBatchRequest = { offset: number; limit: number; computedRevision: number }
type DispatcherTaskSearchRequest = {
  search: string
  code: string | null
  offset: number
  limit: number
  computedRevision: number
}

export function normalizeDispatcherTaskSearchRequest(input: DispatcherTaskSearchRequest) {
  const search = String(input?.search ?? '').trim()
  const code = input?.code === null ? null : String(input?.code ?? '').trim()
  const offset = Number(input?.offset)
  const limit = Number(input?.limit)
  const computedRevision = Number(input?.computedRevision)
  if (!search && !code) throw new Error('Укажите поиск или тип задачи диспетчера.')
  if (search.length > 120 || (code?.length ?? 0) > 30) throw new Error('Слишком длинный запрос задач диспетчера.')
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error('Некорректная позиция задач диспетчера.')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Некорректное количество задач диспетчера.')
  if (!Number.isSafeInteger(computedRevision) || computedRevision < 0) throw new Error('Некорректная версия задач диспетчера.')
  return { search, code, offset, limit, computedRevision }
}

export const searchDispatcherTaskPages = createServerFn({ method: 'GET' })
  .validator(normalizeDispatcherTaskSearchRequest)
  .handler(async ({ data }): Promise<{ total: number; tasks: RepeatedJointTask[] }> => {
    await assertSecurityScope('entry')
    // A deliberate search scans only the persisted task pages, never weld rows.
    // It is a single DB statement and is not fired for each keystroke.
    const result = await requireDb().execute<{
      sourceRevision: number
      computedRevision: number
      tasks: string | null
    }>(sql`
      select "state"."source_revision" as "sourceRevision",
        "state"."computed_revision" as "computedRevision",
        "page"."tasks" as "tasks"
      from ${dispatcherTaskIndexState} as "state"
      left join ${dispatcherTaskPages} as "page" on true
      where "state"."id" = ${DISPATCHER_INDEX_STATE_ID}
      order by "page"."scope_key", "page"."page_number"
    `)
    const state = result.rows[0]
    if (!state || state.computedRevision !== data.computedRevision ||
      state.sourceRevision !== state.computedRevision) {
      throw new Error('Расчет диспетчера изменился. Обновите список задач.')
    }
    let total = 0
    const tasks: RepeatedJointTask[] = []
    for (const page of result.rows) {
      if (page.tasks === null) continue
      const parsed = JSON.parse(page.tasks) as unknown
      if (!Array.isArray(parsed)) throw new Error('Некорректные данные задач диспетчера.')
      for (const task of parsed as RepeatedJointTask[]) {
        if (!matchesDispatcherWorkspaceTask(task, data.search, data.code)) continue
        if (total >= data.offset && tasks.length < data.limit) tasks.push(task)
        total += 1
      }
    }
    return { total, tasks }
  })

export function normalizeDispatcherTaskBatchRequest(input: DispatcherTaskBatchRequest) {
  const offset = Number(input?.offset)
  const limit = Number(input?.limit)
  const computedRevision = Number(input?.computedRevision)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new Error('Некорректная позиция задач диспетчера.')
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new Error('Некорректное количество задач диспетчера.')
  }
  if (!Number.isSafeInteger(computedRevision) || computedRevision < 0) {
    throw new Error('Некорректная версия задач диспетчера.')
  }
  return { offset, limit, computedRevision }
}

export const getDispatcherTaskBatch = createServerFn({ method: 'GET' })
  .validator(normalizeDispatcherTaskBatchRequest)
  .handler(async ({ data }): Promise<RepeatedJointTask[]> => {
    await assertSecurityScope('entry')
    // Read the revision and every intersecting technical page in one statement.
    // The public batch is by task offset, not by scope/page boundaries.
    const result = await requireDb().execute<{
      sourceRevision: number
      computedRevision: number
      tasks: string | null
      startOffset: number | string | null
    }>(sql`
      with "ranked_pages" as (
        select "tasks", "task_count",
          coalesce(sum("task_count") over (
            order by "scope_key", "page_number"
            rows between unbounded preceding and 1 preceding
          ), 0) as "start_offset"
        from ${dispatcherTaskPages}
      )
      select "state"."source_revision" as "sourceRevision",
        "state"."computed_revision" as "computedRevision",
        "page"."tasks" as "tasks",
        "page"."start_offset" as "startOffset"
      from ${dispatcherTaskIndexState} as "state"
      left join "ranked_pages" as "page"
        on "page"."start_offset" < ${data.offset + data.limit}
        and "page"."start_offset" + "page"."task_count" > ${data.offset}
      where "state"."id" = ${DISPATCHER_INDEX_STATE_ID}
      order by "page"."start_offset"
    `)
    const state = result.rows[0]
    if (!state || state.computedRevision !== data.computedRevision ||
      state.sourceRevision !== state.computedRevision) {
      throw new Error('Расчет диспетчера изменился. Обновите список задач.')
    }
    const tasks: RepeatedJointTask[] = []
    for (const page of result.rows) {
      if (page.tasks === null || page.startOffset === null) continue
      const parsed = JSON.parse(page.tasks) as unknown
      if (!Array.isArray(parsed)) throw new Error('Некорректные данные задач диспетчера.')
      const pageStart = Number(page.startOffset)
      const start = Math.max(0, data.offset - pageStart)
      const end = Math.min(parsed.length, data.offset + data.limit - pageStart)
      tasks.push(...parsed.slice(start, end) as RepeatedJointTask[])
    }
    return tasks
  })
