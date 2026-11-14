import { sql } from 'drizzle-orm'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

export const LARGE_EXPORT_ROWS = 10_000
export const LARGE_EXPORT_CELLS = 1_000_000
// Separate two-int advisory-lock namespace, shared by all Excel entry points.
export const LARGE_EXPORT_LOCK = [84192721, 1] as const

export class LargeExportBusyError extends Error {
  constructor() {
    super('Сейчас в системе формируется большая выгрузка. Повторите скачивание немного позже. Небольшие выгрузки доступны.')
    this.name = 'LargeExportBusyError'
  }
}

export interface ReportOutputLifecycle {
  start(tx: SystemDocumentSequenceTransaction, sourceRows: number): Promise<void>
  finish(): Promise<void>
}

/** Use the export's own transaction: no extra pooled connection, waiting queue,
 * persisted job or expired lease that could admit two concurrent exports.
 * The caller finishes the archive before this transaction commits. */
export function createLargeExportGuard(tx: SystemDocumentSequenceTransaction, columns: number, signal: AbortSignal) {
  let acquired = false
  return async (rows: number) => {
    signal.throwIfAborted()
    if (acquired || rows <= LARGE_EXPORT_ROWS && rows * columns <= LARGE_EXPORT_CELLS) return
    const result = await tx.execute<{ acquired: boolean }>(sql`
      select pg_try_advisory_xact_lock(${LARGE_EXPORT_LOCK[0]}, ${LARGE_EXPORT_LOCK[1]}) as acquired
    `)
    signal.throwIfAborted()
    if (result.rows[0]?.acquired !== true) throw new LargeExportBusyError()
    acquired = true
  }
}
