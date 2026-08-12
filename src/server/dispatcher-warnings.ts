import { createServerFn } from '@tanstack/react-start'
import { desc, eq } from 'drizzle-orm'
import { requireDb } from '@/db'
import { dispatcherAcceptedWarnings, type DispatcherAcceptedWarning } from '@/db/schema'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { assertSecurityScope } from '@/server/security-functions'
import { getDispatcherTaskIndexSnapshot } from '@/server/dispatcher-task-index'
import { getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import {
  canAcceptDispatcherTask,
  getDispatcherTaskAcceptanceContext,
  getDispatcherTaskAcceptanceTitle,
} from '@/lib/dispatcher-task-acceptance'

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
    const snapshot = await getDispatcherTaskIndexSnapshot()
    const task = [...snapshot.repeatedJointTasks, ...snapshot.welderStampExpiryTasks]
      .find((candidate) => candidate.key === key)
    if (!task) throw new Error('Эта задача уже исправлена или изменилась. Обновите диспетчер.')
    if (!canAcceptDispatcherTask(task)) {
      throw new Error('Для этой задачи нельзя создать принятое исключение.')
    }
    const kind = task.kind
    const code = getDispatcherTaskCode(task)
    const title = getDispatcherTaskAcceptanceTitle(task)
    const context = getDispatcherTaskAcceptanceContext(task)

    const db = requireDb()
    return db.transaction(async (tx) => {
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
      if (inserted.length > 0) await markDispatcherTaskIndexDirty(tx)
      return toPayload(row)
    })
  })

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
    if (!data.key) throw new Error('Не передан ключ принятого исключения')
    const db = requireDb()
    await db.transaction(async (tx) => {
      await tx.delete(dispatcherAcceptedWarnings).where(eq(dispatcherAcceptedWarnings.key, data.key))
      await markDispatcherTaskIndexDirty(tx)
    })
    return { ok: true }
  })
