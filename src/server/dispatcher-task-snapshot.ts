import { createServerFn } from '@tanstack/react-start'
import type { DispatcherTaskSnapshotResult } from '@/lib/dispatcher-snapshot-transport'
import { encodeDispatcherSnapshot } from '@/server/dispatcher-snapshot-transport'
export type { DispatcherTaskSnapshotResult } from '@/lib/dispatcher-snapshot-transport'
import { getDispatcherTaskIndexSnapshot } from '@/server/dispatcher-task-index'
import { assertSecurityScope } from '@/server/security-functions'

export type DispatcherTaskSnapshotRequest = { transport?: 'gzip-v1' }

export const getDispatcherTaskVersion = createServerFn({ method: 'GET' })
  .handler(async () => {
    await assertSecurityScope('entry')
    const { requireDb } = await import('@/db')
    const { readDispatcherTaskVersion } = await import('@/server/dispatcher-task-version')
    return readDispatcherTaskVersion(requireDb())
  })

export const getDispatcherTaskSnapshot = createServerFn({ method: 'GET' })
  .validator((data: DispatcherTaskSnapshotRequest | undefined) => data ?? {})
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    // The client starts exactly one revision-keyed POST refresh after reading
    // a stale snapshot. Avoid starting a second unobserved refresh from GET.
    const snapshot = await getDispatcherTaskIndexSnapshot({ scheduleRefresh: false })
    const result = toSnapshotResult(snapshot)
    return data.transport === 'gzip-v1' ? encodeDispatcherSnapshot(result) : result
  })

export const refreshDispatcherTaskSnapshot = createServerFn({ method: 'POST' })
  .validator((data: DispatcherTaskSnapshotRequest | undefined) => data ?? {})
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    const result = toSnapshotResult(await getDispatcherTaskIndexSnapshot({ ensureFresh: true }))
    return data.transport === 'gzip-v1' ? encodeDispatcherSnapshot(result) : result
  })

function toSnapshotResult(
  snapshot: Awaited<ReturnType<typeof getDispatcherTaskIndexSnapshot>>,
): DispatcherTaskSnapshotResult {
  return {
    duplicateKeys: snapshot.duplicateKeys,
    repeatedJointTasks: snapshot.repeatedJointTasks,
    repeatedJointTaskCount: snapshot.repeatedJointTaskCount,
    repeatedJointTaskPageCount: snapshot.repeatedJointTaskPageCount,
    repeatedJointTasksTruncated: snapshot.repeatedJointTasksTruncated,
    taskFilterOptions: snapshot.taskFilterOptions,
    welderStampExpiryTasks: snapshot.welderStampExpiryTasks,
    sourceRevision: snapshot.sourceRevision,
    computedRevision: snapshot.computedRevision,
    isFresh: snapshot.isFresh,
    computedAt: snapshot.computedAt,
  }
}
