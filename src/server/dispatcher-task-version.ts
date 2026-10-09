import { eq } from 'drizzle-orm'
import { dispatcherTaskIndexState } from '@/db/schema'
import { getBusinessDateIso } from '@/lib/business-date'
import { DISPATCHER_TASK_CALCULATION_VERSION } from '@/lib/dispatcher-task-index-payload'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'

/** Read-only PK lookup. Never read/toast task JSON, scan joints, initialize the
 * index, or schedule a rebuild just to check whether the client is current. */
export async function readDispatcherTaskVersion(db: Pick<SystemDocumentSequenceTransaction, 'select'>) {
  const [state] = await db.select({
    sourceRevision: dispatcherTaskIndexState.sourceRevision,
    computedRevision: dispatcherTaskIndexState.computedRevision,
    computedAt: dispatcherTaskIndexState.computedAt,
  }).from(dispatcherTaskIndexState).where(eq(dispatcherTaskIndexState.id, 1)).limit(1)
  return {
    sourceRevision: state?.sourceRevision ?? -1,
    computedRevision: state?.computedRevision ?? -1,
    computedAt: state?.computedAt?.toISOString() ?? '',
    computedForBusinessDate: state?.computedAt ? getBusinessDateIso(state.computedAt) : '',
    businessDate: getBusinessDateIso(),
    calculationVersion: DISPATCHER_TASK_CALCULATION_VERSION,
  }
}
