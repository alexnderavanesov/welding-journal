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
  computedAt: string
}

export const getDispatcherTaskSnapshot = createServerFn({ method: 'GET' })
  .validator((data: DispatcherTaskSnapshotRequest | undefined) => data ?? {})
  .handler(async (): Promise<DispatcherTaskSnapshotResult> => {
    await assertSecurityScope('entry')
    const snapshot = await getDispatcherTaskIndexSnapshot()

    return {
      duplicateKeys: snapshot.duplicateKeys,
      repeatedJointTasks: snapshot.repeatedJointTasks,
      taskFilterOptions: snapshot.taskFilterOptions,
      welderStampExpiryTasks: snapshot.welderStampExpiryTasks,
      computedAt: snapshot.computedAt,
    }
  })
