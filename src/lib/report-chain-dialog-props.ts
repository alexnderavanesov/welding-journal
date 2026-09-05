import type { ReportChainDialogProps } from '@/components/report-chain-dialog'

type ChainDialogProps = NonNullable<ReportChainDialogProps['dialogProps']>

type CreateReportChainDialogPropsOptions = {
  chainRecord: ChainDialogProps['record'] | null
  chainRows: ChainDialogProps['rows']
  transitions: ChainDialogProps['transitions']
  earlyCoilCandidates: ChainDialogProps['earlyCoilCandidates']
  dispatcherTasks: ChainDialogProps['dispatcherTasks']
  errorMessage: ChainDialogProps['errorMessage']
  isLoading: ChainDialogProps['isLoading']
  onClose: ChainDialogProps['onClose']
  onOpenBase: ChainDialogProps['onOpenBase']
  onOpenRow: ChainDialogProps['onOpenRow']
  onOpenDocument: ChainDialogProps['onOpenDocument']
  onOpenReport: ChainDialogProps['onOpenReport']
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
  chainRows,
  transitions,
  earlyCoilCandidates,
  dispatcherTasks,
  errorMessage,
  isLoading,
  onClose,
  onOpenBase,
  onOpenRow,
  onOpenDocument,
  onOpenReport,
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
          rows: chainRows,
          transitions,
          earlyCoilCandidates,
          dispatcherTasks,
          errorMessage,
          isLoading,
          onClose,
          onOpenBase,
          onOpenRow,
          onOpenDocument,
          onOpenReport,
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
