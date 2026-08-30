import type { ReportChainDialogProps } from '@/components/report-chain-dialog'

type ChainDialogProps = NonNullable<ReportChainDialogProps['dialogProps']>

type CreateReportChainDialogPropsOptions = {
  chainRecord: ChainDialogProps['record'] | null
  chainRows: ChainDialogProps['rows']
  dispatcherTasks: ChainDialogProps['dispatcherTasks']
  errorMessage: ChainDialogProps['errorMessage']
  isLoading: ChainDialogProps['isLoading']
  onClose: ChainDialogProps['onClose']
  onOpenBase: ChainDialogProps['onOpenBase']
  onOpenRow: ChainDialogProps['onOpenRow']
  onOpenDocument: ChainDialogProps['onOpenDocument']
  onOpenReport: ChainDialogProps['onOpenReport']
  onRunNextAction: ChainDialogProps['onRunNextAction']
  onRetry: ChainDialogProps['onRetry']
}

export function createReportChainDialogProps({
  chainRecord,
  chainRows,
  dispatcherTasks,
  errorMessage,
  isLoading,
  onClose,
  onOpenBase,
  onOpenRow,
  onOpenDocument,
  onOpenReport,
  onRunNextAction,
  onRetry,
}: CreateReportChainDialogPropsOptions): ReportChainDialogProps {
  return {
    dialogProps: chainRecord
      ? {
          record: chainRecord,
          rows: chainRows,
          dispatcherTasks,
          errorMessage,
          isLoading,
          onClose,
          onOpenBase,
          onOpenRow,
          onOpenDocument,
          onOpenReport,
          onRunNextAction,
          onRetry,
        }
      : null,
  }
}
