import type { ReportChainDialogProps } from '@/components/report-chain-dialog'

type ChainDialogProps = NonNullable<ReportChainDialogProps['dialogProps']>

type CreateReportChainDialogPropsOptions = {
  chainRecord: ChainDialogProps['record'] | null
  chainRows: ChainDialogProps['rows']
  errorMessage: ChainDialogProps['errorMessage']
  isLoading: ChainDialogProps['isLoading']
  onClose: ChainDialogProps['onClose']
  onOpenBase: ChainDialogProps['onOpenBase']
  onOpenRow: ChainDialogProps['onOpenRow']
  onRetry: ChainDialogProps['onRetry']
}

export function createReportChainDialogProps({
  chainRecord,
  chainRows,
  errorMessage,
  isLoading,
  onClose,
  onOpenBase,
  onOpenRow,
  onRetry,
}: CreateReportChainDialogPropsOptions): ReportChainDialogProps {
  return {
    dialogProps: chainRecord
      ? {
          record: chainRecord,
          rows: chainRows,
          errorMessage,
          isLoading,
          onClose,
          onOpenBase,
          onOpenRow,
          onRetry,
        }
      : null,
  }
}
