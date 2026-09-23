import { createServerFn } from '@tanstack/react-start'
import type {
  RepeatedJointTask,
  WelderStampExpiryTask,
} from '@/lib/dispatcher-types'
import { getDispatcherTaskIndexSnapshot } from '@/server/dispatcher-task-index'
import { assertSecurityScope } from '@/server/security-functions'

export type DispatcherTaskSnapshotRequest = Record<string, never>

export type DispatcherTaskSnapshotResult = {
  duplicateKeys: string[]
  repeatedJointTasks: RepeatedJointTask[]
  taskFilterOptions: Array<{ value: string; count: number; label: string }>
  welderStampExpiryTasks: WelderStampExpiryTask[]
  repeatedJointTaskCount: number
  repeatedJointTaskPageCount: number
  repeatedJointTasksTruncated: boolean
  sourceRevision: number
  computedRevision: number
  isFresh: boolean
  computedAt: string
}

export const getDispatcherTaskSnapshot = createServerFn({ method: 'GET' })
  .validator((data: DispatcherTaskSnapshotRequest | undefined) => data ?? {})
  .handler(async (): Promise<DispatcherTaskSnapshotResult> => {
    await assertSecurityScope('entry')
    // The client starts exactly one revision-keyed POST refresh after reading
    // a stale snapshot. Avoid starting a second unobserved refresh from GET.
    const snapshot = await getDispatcherTaskIndexSnapshot({ scheduleRefresh: false })
    return toSnapshotResult(snapshot)
  })

export const refreshDispatcherTaskSnapshot = createServerFn({ method: 'POST' })
  .validator((data: DispatcherTaskSnapshotRequest | undefined) => data ?? {})
  .handler(async (): Promise<DispatcherTaskSnapshotResult> => {
    await assertSecurityScope('entry')
    return toSnapshotResult(await getDispatcherTaskIndexSnapshot({ ensureFresh: true }))
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
