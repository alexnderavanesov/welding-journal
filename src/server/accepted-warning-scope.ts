import { and, isNull, or } from 'drizzle-orm'
import { dispatcherAcceptedWarnings } from '@/db/schema'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildNumberArrayMatch } from './weld-request-utils'

/** Indexed object predicates; only keys are needed to calculate the dispatcher. */
export async function loadScopedAcceptedWarningKeys(tx: Pick<SystemDocumentSequenceTransaction, 'select'>, rows: readonly { id: number; lineProgramId?: number | null }[]) {
  return tx.select({ key: dispatcherAcceptedWarnings.key }).from(dispatcherAcceptedWarnings).where(or(
    buildNumberArrayMatch(dispatcherAcceptedWarnings.weldJointId, rows.map(row => row.id)),
    buildNumberArrayMatch(dispatcherAcceptedWarnings.lineProgramId, [...new Set(rows.flatMap(row => row.lineProgramId ? [row.lineProgramId] : []))]),
    // Stamp decisions are global. Unowned legacy decisions remain effective until
    // their explicit object backfill; do not silently discard accepted history.
    and(isNull(dispatcherAcceptedWarnings.weldJointId), isNull(dispatcherAcceptedWarnings.lineProgramId)),
  ))
}
