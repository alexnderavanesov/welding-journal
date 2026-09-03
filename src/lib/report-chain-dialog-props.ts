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
  onRunNextAction: ChainDialogProps['onRunNextAction']
  canCreateEarlyCoil: ChainDialogProps['canCreateEarlyCoil']
  isEarlyCoilPending: ChainDialogProps['isEarlyCoilPending']
  onCreateEarlyCoil: ChainDialogProps['onCreateEarlyCoil']
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
  onRunNextAction,
  canCreateEarlyCoil,
  isEarlyCoilPending,
  onCreateEarlyCoil,
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
          onRunNextAction,
          canCreateEarlyCoil,
          isEarlyCoilPending,
          onCreateEarlyCoil,
          onRetry,
        }
      : null,
  }
}
