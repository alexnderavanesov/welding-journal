import { createServerFn } from '@tanstack/react-start'
import { eq, inArray, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { dispatcherTaskIndexState, dispatcherTaskPages, weldJoints } from '@/db/schema'
import type { RepeatedJointTask } from '@/lib/dispatcher-types'
import { assertSecurityScope } from './security-functions'
import { DISPATCHER_INDEX_STATE_ID } from './dispatcher-task-index-constants'
import { getDispatcherScopeKey } from './dispatcher-weld-rows'

export type DispatcherTaskContextRequest = {
  rowIds: number[]
  computedRevision: number
  mode: 'rows' | 'line'
  offset?: number
}
export type DispatcherTaskContextResult = { tasks: RepeatedJointTask[]; total: number }
export const DISPATCHER_CONTEXT_ROW_LIMIT = 500
export const DISPATCHER_LINE_TASK_LIMIT = 200

export function normalizeDispatcherTaskContextRequest(input: DispatcherTaskContextRequest) {
  if (input?.mode !== 'rows' && input?.mode !== 'line') throw new Error('Некорректная область задач.')
  if (!Array.isArray(input.rowIds) || !input.rowIds.length || input.rowIds.length > DISPATCHER_CONTEXT_ROW_LIMIT ||
    input.rowIds.some(id => !Number.isSafeInteger(id) || id < 1) || input.mode === 'line' && input.rowIds.length !== 1) {
    throw new Error('Некорректный список стыков для задач.')
  }
  if (!Number.isSafeInteger(input.computedRevision) || input.computedRevision < 0) throw new Error('Некорректная версия задач.')
  const offset = input.offset ?? 0
  if (!Number.isSafeInteger(offset) || offset < 0 || input.mode === 'rows' && offset !== 0) throw new Error('Некорректная позиция задач.')
  return { ...input, rowIds: [...new Set(input.rowIds)].sort((a, b) => a - b), offset }
}

// Scoped reads never calculate tasks or hydrate the journal. A repeatable-read
// snapshot keeps identities, published revision and task pages consistent.
export const getDispatcherTaskContext = createServerFn({ method: 'POST' })
  .validator(normalizeDispatcherTaskContextRequest)
  .handler(async ({ data }): Promise<DispatcherTaskContextResult> => {
    await assertSecurityScope('entry')
    return loadDispatcherTaskContext(data)
  })

export async function loadDispatcherTaskContext(data: ReturnType<typeof normalizeDispatcherTaskContextRequest>): Promise<DispatcherTaskContextResult> {
    return requireDb().transaction(async tx => {
      const [state] = await tx.select({ source: dispatcherTaskIndexState.sourceRevision, computed: dispatcherTaskIndexState.computedRevision })
        .from(dispatcherTaskIndexState).where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID))
      if (!state || state.source !== state.computed || state.computed !== data.computedRevision) {
        throw new Error('Расчёт диспетчера изменился. Обновите задачи и повторите загрузку.')
      }
      const rows = await tx.select({ id: weldJoints.id, projectTitle: weldJoints.projectTitle,
        subtitleCode: weldJoints.subtitleCode, line: weldJoints.line, joint: weldJoints.joint })
        .from(weldJoints).where(inArray(weldJoints.id, data.rowIds))
      if (!rows.length) {
        if (data.mode === 'line') throw new Error('Стык больше не существует. Закройте картину и обновите отчёт.')
        return { tasks: [], total: 0 }
      }
      const scopes = [...new Set(rows.map(getDispatcherScopeKey))]
      const scopeFilter = inArray(dispatcherTaskPages.scopeKey, scopes)
      if (data.mode === 'line') {
        // Rank narrow metadata first; fetch JSON only for intersecting pages.
        const result = await tx.execute<{ tasks: string | null; start: number | string | null; total: number | string }>(sql`
          with pages as (
            select scope_key, page_number, task_count,
              coalesce(sum(task_count) over (order by scope_key, page_number rows between unbounded preceding and 1 preceding),0) as start
            from ${dispatcherTaskPages} where ${scopeFilter}
          ), total as (select coalesce(sum(task_count),0) as count from pages)
          select stored.tasks, pages.start, total.count as total from total
          left join pages on pages.start < ${data.offset + DISPATCHER_LINE_TASK_LIMIT}
            and pages.start + pages.task_count > ${data.offset}
          left join ${dispatcherTaskPages} as stored on stored.scope_key=pages.scope_key and stored.page_number=pages.page_number
          order by pages.start
        `)
        const tasks: RepeatedJointTask[] = []
        for (const page of result.rows) {
          if (page.tasks === null || page.start === null) continue
          const start = Number(page.start)
          tasks.push(...(JSON.parse(page.tasks) as RepeatedJointTask[]).slice(Math.max(0, data.offset - start), data.offset + DISPATCHER_LINE_TASK_LIMIT - start))
        }
        return { tasks, total: Number(result.rows[0]?.total ?? 0) }
      }
      const ids = JSON.stringify(rows.map(row => String(row.id)))
      const duplicates = JSON.stringify(rows.map(row => [getDispatcherScopeKey(row), String(row.joint ?? '').trim().toLowerCase()]))
      // Scope-key PK narrows pages before JSON expansion. Return only matching
      // cards, not the whole lines; source/changes cover repair and rename tasks.
      const result = await tx.execute<{ task: RepeatedJointTask }>(sql`
        select card.value as task from ${dispatcherTaskPages}
        cross join lateral jsonb_array_elements(tasks::jsonb) with ordinality as card(value, position)
        where ${scopeFilter} and (
          ${ids}::jsonb ? (card.value->'row'->>'id') or
          ${ids}::jsonb ? (card.value->'sourceRow'->>'id') or
          exists (select 1 from jsonb_array_elements(coalesce(card.value->'changes','[]'::jsonb)) change where ${ids}::jsonb ? (change->>'rowId')) or
          exists (select 1 from jsonb_array_elements_text(coalesce(card.value->'actualityRowIds','[]'::jsonb)) id where ${ids}::jsonb ? id) or
          (card.value->>'kind'='duplicate-check' and exists (
            select 1 from jsonb_array_elements(${duplicates}::jsonb) identity
            where identity->>0=scope_key and identity->>1=lower(btrim(coalesce(card.value->'row'->>'joint','')))
          ))
        ) order by scope_key, page_number, card.position
      `)
      const tasks = result.rows.map(row => row.task)
      return { tasks, total: tasks.length }
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}
