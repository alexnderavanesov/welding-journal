import { createServerFn } from '@tanstack/react-start'
import type {
  RepeatedJointTask,
  WelderStampExpiryTask,
} from '@/lib/dispatcher-types'
import { getDispatcherTaskIndexSnapshot } from '@/server/dispatcher-task-index'

export type DispatcherTaskSnapshotRequest = {
  dismissedRepeatedJointTaskKeys?: string[]
}

export type DispatcherTaskSnapshotResult = {
  duplicateKeys: string[]
  repeatedJointTasks: RepeatedJointTask[]
  taskFilterOptions: Array<{ value: string; count: number; label: string }>
  welderStampExpiryTasks: WelderStampExpiryTask[]
  computedAt: string
}

export const getDispatcherTaskSnapshot = createServerFn({ method: 'GET' })
  .validator((data: DispatcherTaskSnapshotRequest | undefined) => data ?? {})
  .handler(async ({ data }): Promise<DispatcherTaskSnapshotResult> => {
    const snapshot = await getDispatcherTaskIndexSnapshot(data.dismissedRepeatedJointTaskKeys)

    return {
      duplicateKeys: snapshot.duplicateKeys,
      repeatedJointTasks: snapshot.repeatedJointTasks,
      taskFilterOptions: snapshot.taskFilterOptions,
      welderStampExpiryTasks: snapshot.welderStampExpiryTasks,
      computedAt: snapshot.computedAt,
    }
  })
