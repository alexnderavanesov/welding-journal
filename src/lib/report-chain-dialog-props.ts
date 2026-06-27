import type { ReportChainDialogProps } from '@/components/report-chain-dialog'

type ChainDialogProps = NonNullable<ReportChainDialogProps['dialogProps']>

type CreateReportChainDialogPropsOptions = {
  chainRecord: ChainDialogProps['record'] | null
  chainRows: ChainDialogProps['rows']
  onClose: ChainDialogProps['onClose']
  onOpenBase: ChainDialogProps['onOpenBase']
  onOpenRow: ChainDialogProps['onOpenRow']
}

export function createReportChainDialogProps({
  chainRecord,
  chainRows,
  onClose,
  onOpenBase,
  onOpenRow,
}: CreateReportChainDialogPropsOptions): ReportChainDialogProps {
  return {
    dialogProps: chainRecord
      ? {
          record: chainRecord,
          rows: chainRows,
          onClose,
          onOpenBase,
          onOpenRow,
        }
      : null,
  }
}
