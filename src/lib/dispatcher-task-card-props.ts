import type { DispatcherTaskCardHandlers } from '@/components/dispatcher-task-card'
import type { ActiveReport } from '@/lib/home-state'

type CreateDispatcherTaskCardHandlersOptions = Omit<
  DispatcherTaskCardHandlers,
  'canRunDispatcherMutation' | 'canCreateEarlyCoil' | 'isCreatePending' | 'isEarlyCoilPending' | 'isDeletePending' | 'isRenamePending'
> & {
  activeReport: ActiveReport
  isCreatePending: boolean
  isEarlyCoilPending: boolean
  isDeletePending: boolean
  isRenamePending: boolean
}

export function createDispatcherTaskCardHandlers({
  activeReport,
  isCreatePending,
  isEarlyCoilPending,
  isDeletePending,
  isRenamePending,
  ...handlers
}: CreateDispatcherTaskCardHandlersOptions): DispatcherTaskCardHandlers {
  return {
    ...handlers,
    canRunDispatcherMutation: activeReport !== 'lnk',
    canCreateEarlyCoil: activeReport === 'weldingJournal',
    isCreatePending,
    isEarlyCoilPending,
    isDeletePending,
    isRenamePending,
  }
}
