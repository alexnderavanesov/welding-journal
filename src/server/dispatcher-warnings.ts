import { createServerFn } from '@tanstack/react-start'
import { desc, eq } from 'drizzle-orm'
import { requireDb } from '@/db'
import { dispatcherAcceptedWarnings, type DispatcherAcceptedWarning } from '@/db/schema'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { assertSecurityScope } from '@/server/security-functions'

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
  kind: string
  code?: string
  title?: string
  context?: string
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
    const kind = String(data.kind ?? '').trim()
    const code = String(data.code ?? '').trim()
    const title = String(data.title ?? '').trim()
    const context = String(data.context ?? '').trim()

    if (!key) throw new Error('Не передан ключ предупреждения')
    if (!kind) throw new Error('Не передан тип предупреждения')

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
