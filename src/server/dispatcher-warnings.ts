import { createServerFn } from '@tanstack/react-start'
import { asc, eq } from 'drizzle-orm'
import { requireDb } from '@/db'
import { dispatcherAcceptedWarnings, type DispatcherAcceptedWarning } from '@/db/schema'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'

export type DispatcherAcceptedWarningPayload = {
  key: string
  kind: string
  title: string
  acceptedAt: string
}

type AcceptDispatcherWarningInput = {
  key: string
  kind: string
  title?: string
}

const toPayload = (row: DispatcherAcceptedWarning): DispatcherAcceptedWarningPayload => ({
  key: row.key,
  kind: row.kind,
  title: row.title ?? '',
  acceptedAt: row.acceptedAt.toISOString(),
})

export const listDispatcherAcceptedWarnings = createServerFn({ method: 'GET' }).handler(async () => {
  const db = requireDb()
  const rows = await db.select().from(dispatcherAcceptedWarnings).orderBy(asc(dispatcherAcceptedWarnings.acceptedAt))
  return rows.map(toPayload)
})

export const acceptDispatcherWarning = createServerFn({ method: 'POST' })
  .validator((data: AcceptDispatcherWarningInput) => data)
  .handler(async ({ data }) => {
    const key = String(data.key ?? '').trim()
    const kind = String(data.kind ?? '').trim()
    const title = String(data.title ?? '').trim()

    if (!key) throw new Error('Не передан ключ предупреждения')
    if (!kind) throw new Error('Не передан тип предупреждения')

    const db = requireDb()
    return db.transaction(async (tx) => {
      const inserted = await tx
        .insert(dispatcherAcceptedWarnings)
        .values({ key, kind, title: title || null })
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
