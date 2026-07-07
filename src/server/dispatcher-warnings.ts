import { createServerFn } from '@tanstack/react-start'
import { asc, eq, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { dispatcherAcceptedWarnings, type DispatcherAcceptedWarning } from '@/db/schema'

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

async function ensureDispatcherAcceptedWarningsTable() {
  const db = requireDb()
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "dispatcher_accepted_warnings" (
      "key" text PRIMARY KEY NOT NULL,
      "kind" text NOT NULL,
      "title" text,
      "accepted_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `)
}

export const listDispatcherAcceptedWarnings = createServerFn({ method: 'GET' }).handler(async () => {
  await ensureDispatcherAcceptedWarningsTable()
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

    await ensureDispatcherAcceptedWarningsTable()
    const db = requireDb()
    await db
      .insert(dispatcherAcceptedWarnings)
      .values({ key, kind, title: title || null })
      .onConflictDoNothing()

    const [row] = await db.select().from(dispatcherAcceptedWarnings).where(eq(dispatcherAcceptedWarnings.key, key)).limit(1)
    if (!row) throw new Error('Не удалось сохранить принятое предупреждение')
    return toPayload(row)
  })
