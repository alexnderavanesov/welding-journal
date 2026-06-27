import type { DispatcherTaskCardHandlers } from '@/components/dispatcher-task-card'
import type { ActiveReport } from '@/lib/home-state'

type CreateDispatcherTaskCardHandlersOptions = Omit<
  DispatcherTaskCardHandlers,
  'canRunDispatcherMutation' | 'isCreatePending' | 'isDeletePending' | 'isRenamePending'
> & {
  activeReport: ActiveReport
  isCreatePending: boolean
  isDeletePending: boolean
  isRenamePending: boolean
}

export function createDispatcherTaskCardHandlers({
  activeReport,
  isCreatePending,
  isDeletePending,
  isRenamePending,
  ...handlers
}: CreateDispatcherTaskCardHandlersOptions): DispatcherTaskCardHandlers {
  return {
    ...handlers,
    canRunDispatcherMutation: activeReport !== 'lnk',
    isCreatePending,
    isDeletePending,
    isRenamePending,
  }
}
