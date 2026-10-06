import { sql } from 'drizzle-orm'
import { DATA_RELEASE_KEY, DATA_RELEASE_VALUE, LINE_PROGRAM_TRANSITION_KEY, isCompletedTransition } from '@/lib/release-contract'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

/** Read-only, bounded metadata checks. Works even before the first migration. */
export async function isDatabaseReleaseReady(db: Pick<SystemDocumentSequenceTransaction, 'execute'>) {
  const tables = await db.execute(sql`select to_regclass('public.app_settings') is not null as available`)
  if (tables.rows[0]?.available !== true) return false
  const result = await db.execute(sql`select
    (select value from public.app_settings where key = ${DATA_RELEASE_KEY}) as release,
    (select value from public.app_settings where key = ${LINE_PROGRAM_TRANSITION_KEY}) as transition`)
  const row = result.rows[0]
  return row?.release === DATA_RELEASE_VALUE
    && isCompletedTransition(row.transition as string | null)
}
