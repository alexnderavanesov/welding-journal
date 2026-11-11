import { and, eq, inArray, sql } from 'drizzle-orm'
import { lineSchemeFiles, lineSchemeReceipts, lineSchemeRevisions } from '@/db/schema'
import type { requireDb } from '@/db'
import type { SchemeFileStore } from './line-scheme-files'

type Database = ReturnType<typeof requireDb>
const unused = sql`not exists (select 1 from ${lineSchemeRevisions} where ${lineSchemeRevisions.fileKey} = ${lineSchemeFiles.key})`

/** Claim in a short transaction, perform storage I/O outside it, then acknowledge.
 * deleting is terminal: publishSchemeFile only accepts unexpired staging rows.
 * expiresAt is a recoverable deletion lease; no schema change or background poll.
 * The shared network budget bounds the delay before a mutation's HTTP response. */
export async function cleanupSchemeFilesInStore(db: Database, store: SchemeFileStore, networkBudgetMs = 2_000) {
  const claimed = await db.transaction(async tx => {
    const files = await tx.select({ key: lineSchemeFiles.key }).from(lineSchemeFiles).where(and(unused,
      sql`((${lineSchemeFiles.state} = 'deleting' and (${lineSchemeFiles.expiresAt} is null or ${lineSchemeFiles.expiresAt} < now()))
        or (${lineSchemeFiles.state} = 'staging' and ${lineSchemeFiles.expiresAt} < now()))`))
      .orderBy(lineSchemeFiles.createdAt).limit(10).for('update', { skipLocked: true })
    await tx.delete(lineSchemeReceipts).where(sql`${lineSchemeReceipts.createdAt} < now() - interval '7 days'`)
    if (!files.length) return []
    return tx.update(lineSchemeFiles).set({ state: 'deleting', expiresAt: sql`date_trunc('milliseconds', now()) + interval '1 minute'` })
      .where(inArray(lineSchemeFiles.key, files.map(file => file.key)))
      .returning({ key: lineSchemeFiles.key, expiresAt: lineSchemeFiles.expiresAt })
  })
  if (!claimed.length) return
  const signal = AbortSignal.timeout(networkBudgetMs)
  const remaining = new Set(claimed.map(file => file.key))
  const owned = (file: typeof claimed[number]) => and(eq(lineSchemeFiles.key, file.key), eq(lineSchemeFiles.state, 'deleting'), eq(lineSchemeFiles.expiresAt, file.expiresAt!))
  try {
    for (const file of claimed) {
      if (signal.aborted) break
      try {
        await store.remove(file.key, signal)
        // A changed lease or a referenced row must never be acknowledged by an old worker.
        await db.delete(lineSchemeFiles).where(and(owned(file), unused))
        remaining.delete(file.key)
      } catch { /* Retain durable deleting state; other candidates can still complete. */ }
    }
  } finally {
    // Immediate retry remains possible after failure. If the process dies, the
    // one-minute lease expires instead; another process cannot claim live work.
    for (const file of claimed) if (remaining.has(file.key)) {
      await db.update(lineSchemeFiles).set({ expiresAt: null }).where(owned(file))
    }
  }
  if (remaining.size) throw new Error('Очистка неиспользуемых PDF отложена. Следующая операция повторит попытку.')
}
