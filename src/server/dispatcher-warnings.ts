import { createServerFn } from '@tanstack/react-start'
import { desc, eq, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  dispatcherAcceptedWarnings,
  dispatcherTaskIndexState,
  type DispatcherAcceptedWarning,
} from '@/db/schema'
import {
  getDispatcherDirtyScopes,
  markDispatcherTaskIndexDirty,
} from '@/server/dispatcher-task-index-dirty'
import { assertSecurityScope } from '@/server/security-functions'
import { ensureDispatcherTaskIndexFresh } from '@/server/dispatcher-task-index'
import { getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import {
  canAcceptDispatcherTask,
  getDispatcherTaskAcceptanceContext,
  getDispatcherTaskAcceptanceTitle,
} from '@/lib/dispatcher-task-acceptance'
import { parseEarlyCoilDecisionKey } from '@/lib/early-coil-decision'
import { revokeEarlyCoilDecisionInTransaction } from '@/server/early-coil-workflow'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import {
  DISPATCHER_INDEX_LOCK_ID,
  DISPATCHER_INDEX_STATE_ID,
} from '@/server/dispatcher-task-index-constants'
import {
  isDispatcherTaskIndexPayloadCurrent,
  parseDispatcherTaskIndexPayload,
} from '@/lib/dispatcher-task-index-payload'
import type { DispatcherTask, WelderStampExpiryTask } from '@/lib/dispatcher-types'

export type DispatcherAcceptedWarningPayload = {
  key: string
  kind: string
  code: string
  title: string
  context: string
  acceptedAt: string
}

type AcceptDispatcherWarningInput = {
  key: string
}

const toPayload = (row: DispatcherAcceptedWarning): DispatcherAcceptedWarningPayload => ({
  key: row.key,
  kind: row.kind,
  code: row.code ?? '',
  title: row.title ?? '',
  context: row.context ?? '',
  acceptedAt: row.acceptedAt.toISOString(),
})

export const acceptDispatcherWarning = createServerFn({ method: 'POST' })
  .validator((data: AcceptDispatcherWarningInput) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const key = String(data.key ?? '').trim()
    if (!key) throw new Error('Не передан ключ предупреждения')
    await ensureDispatcherTaskIndexFresh()
    const db = requireDb()
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${DISPATCHER_INDEX_LOCK_ID})`)
      const [state] = await tx
        .select()
        .from(dispatcherTaskIndexState)
        .where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID))
        .limit(1)
      const task = findCurrentDispatcherTask(key, state)
      if (!task) throw new Error('Эта задача уже исправлена или изменилась. Обновите диспетчер.')
      if (!canAcceptDispatcherTask(task)) {
        throw new Error('Для этой задачи нельзя создать принятое исключение.')
      }
      const kind = task.kind
      const code = getDispatcherTaskCode(task)
      const title = getDispatcherTaskAcceptanceTitle(task)
      const context = getDispatcherTaskAcceptanceContext(task)
      const inserted = await tx
        .insert(dispatcherAcceptedWarnings)
        .values({ key, kind, code: code || null, title: title || null, context: context || null })
        .onConflictDoNothing()
        .returning()
      const [row] = inserted.length > 0
        ? inserted
        : await tx
            .select()
            .from(dispatcherAcceptedWarnings)
            .where(eq(dispatcherAcceptedWarnings.key, key))
            .limit(1)
      if (!row) throw new Error('Не удалось сохранить принятое предупреждение')
      if (inserted.length > 0 && 'row' in task) {
        await markDispatcherTaskIndexDirty(tx, {
          scopes: getDispatcherDirtyScopes([task.row], new Map()),
        })
      }
      return toPayload(row)
    })
  })

function findCurrentDispatcherTask(
  key: string,
  state: typeof dispatcherTaskIndexState.$inferSelect | undefined,
): DispatcherTask | undefined {
  if (
    !state ||
    state.sourceRevision !== state.computedRevision ||
    state.fullRebuild ||
    !isDispatcherTaskIndexPayloadCurrent(state.repeatedTasks)
  ) return undefined

  return [
    ...parseDispatcherTaskIndexPayload(state.repeatedTasks).tasks,
    ...parseJsonArray<WelderStampExpiryTask>(state.welderStampExpiryTasks),
  ].find((task) => task.key === key)
}

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

export const listDispatcherAcceptedWarnings = createServerFn({ method: 'GET' }).handler(async () => {
  await assertSecurityScope('entry')
  const rows = await requireDb()
    .select()
    .from(dispatcherAcceptedWarnings)
    .orderBy(desc(dispatcherAcceptedWarnings.acceptedAt))
  return rows.map(toPayload)
})

export const revokeDispatcherAcceptedWarning = createServerFn({ method: 'POST' })
  .validator((data: { key: string }) => ({ key: String(data?.key ?? '').trim() }))
  .handler(async ({ data }) => {
    await assertSecurityScope('settings')
    const earlyCoilDecision = parseEarlyCoilDecisionKey(data.key)
    if (earlyCoilDecision) await assertSecurityScope('delete')
    if (!data.key) throw new Error('Не передан ключ принятого исключения')
    const db = requireDb()
    const result = await db.transaction(async (tx) => {
      if (earlyCoilDecision) await loadControlProcessSettingsFromTransaction(tx)
      const earlyCoilResult = await revokeEarlyCoilDecisionInTransaction(tx, data.key)
      if (earlyCoilResult.handled) return { ok: true, deletedRowIds: earlyCoilResult.deletedRowIds }
      await tx.delete(dispatcherAcceptedWarnings).where(eq(dispatcherAcceptedWarnings.key, data.key))
      await markDispatcherTaskIndexDirty(tx)
      return { ok: true, deletedRowIds: [] }
    })
    return result
  })
