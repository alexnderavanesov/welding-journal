import type { ReportChainDialogProps } from '@/components/report-chain-dialog'

type ChainDialogProps = NonNullable<ReportChainDialogProps['dialogProps']>

type CreateReportChainDialogPropsOptions = {
  chainRecord: ChainDialogProps['record'] | null
  initialTab: ChainDialogProps['initialTab']
  focusedTaskKey: ChainDialogProps['focusedTaskKey']
  chainRows: ChainDialogProps['rows']
  transitions: ChainDialogProps['transitions']
  earlyCoilCandidates: ChainDialogProps['earlyCoilCandidates']
  dispatcherTasks: ChainDialogProps['dispatcherTasks']
  controlProcessSettings: ChainDialogProps['controlProcessSettings']
  errorMessage: ChainDialogProps['errorMessage']
  isLoading: ChainDialogProps['isLoading']
  onClose: ChainDialogProps['onClose']
  onOpenBase: ChainDialogProps['onOpenBase']
  onOpenRow: ChainDialogProps['onOpenRow']
  onOpenDocument: ChainDialogProps['onOpenDocument']
  onOpenReport: ChainDialogProps['onOpenReport']
  onOpenLineInDispatcher: ChainDialogProps['onOpenLineInDispatcher']
  onEditRow: ChainDialogProps['onEditRow']
  onRunNextAction: ChainDialogProps['onRunNextAction']
  onRunDispatcherTaskAction: ChainDialogProps['onRunDispatcherTaskAction']
  canCreateRepeatedJoint: ChainDialogProps['canCreateRepeatedJoint']
  isRepeatedJointPending: ChainDialogProps['isRepeatedJointPending']
  onCreateRepeatedJoint: ChainDialogProps['onCreateRepeatedJoint']
  canRenameRepeatedJoint: ChainDialogProps['canRenameRepeatedJoint']
  isRenameRepeatedJointPending: ChainDialogProps['isRenameRepeatedJointPending']
  onRenameRepeatedJoint: ChainDialogProps['onRenameRepeatedJoint']
  canCreateEarlyCoil: ChainDialogProps['canCreateEarlyCoil']
  isEarlyCoilPending: ChainDialogProps['isEarlyCoilPending']
  onCreateEarlyCoil: ChainDialogProps['onCreateEarlyCoil']
  onOpenOfficiality: ChainDialogProps['onOpenOfficiality']
  onRetry: ChainDialogProps['onRetry']
}

export function createReportChainDialogProps({
  chainRecord,
  initialTab,
  focusedTaskKey,
  chainRows,
  transitions,
  earlyCoilCandidates,
  dispatcherTasks,
  controlProcessSettings,
  errorMessage,
  isLoading,
  onClose,
  onOpenBase,
  onOpenRow,
  onOpenDocument,
  onOpenReport,
  onOpenLineInDispatcher,
  onEditRow,
  onRunNextAction,
  onRunDispatcherTaskAction,
  canCreateRepeatedJoint,
  isRepeatedJointPending,
  onCreateRepeatedJoint,
  canRenameRepeatedJoint,
  isRenameRepeatedJointPending,
  onRenameRepeatedJoint,
  canCreateEarlyCoil,
  isEarlyCoilPending,
  onCreateEarlyCoil,
  onOpenOfficiality,
  onRetry,
}: CreateReportChainDialogPropsOptions): ReportChainDialogProps {
  return {
    dialogProps: chainRecord
      ? {
          record: chainRecord,
          initialTab,
          focusedTaskKey,
          rows: chainRows,
          transitions,
          earlyCoilCandidates,
          dispatcherTasks,
          controlProcessSettings,
          errorMessage,
          isLoading,
          onClose,
          onOpenBase,
          onOpenRow,
          onOpenDocument,
          onOpenReport,
          onOpenLineInDispatcher,
          onEditRow,
          onRunNextAction,
          onRunDispatcherTaskAction,
          canCreateRepeatedJoint,
          isRepeatedJointPending,
          onCreateRepeatedJoint,
          canRenameRepeatedJoint,
          isRenameRepeatedJointPending,
          onRenameRepeatedJoint,
          canCreateEarlyCoil,
          isEarlyCoilPending,
          onCreateEarlyCoil,
          onOpenOfficiality,
          onRetry,
        }
      : null,
  }
}
