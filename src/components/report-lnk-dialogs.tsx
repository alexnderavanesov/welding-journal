import { LnkOfficialityDialog, type LnkOfficialityDialogProps } from '@/components/lnk-officiality-dialog'
import { LnkRequestDialog, type LnkRequestDialogProps } from '@/components/lnk-request-dialog'
import { LnkRequestManagerDialog, type LnkRequestManagerDialogProps } from '@/components/lnk-request-manager-dialog'
import { LnkResultDialog, type LnkResultDialogProps } from '@/components/lnk-result-dialog'
import { LnkResultManagerDialog, type LnkResultManagerDialogProps } from '@/components/lnk-result-manager-dialog'
import { LnkResultPreviewDialog, type LnkResultPreviewDialogProps } from '@/components/lnk-result-preview-dialog'

export type ReportLnkDialogsProps = {
  requestDialogProps: LnkRequestDialogProps | null
  requestManagerDialogProps: LnkRequestManagerDialogProps | null
  resultManagerDialogProps: LnkResultManagerDialogProps | null
  officialityDialogProps: LnkOfficialityDialogProps | null
  resultDialogProps: LnkResultDialogProps | null
  resultPreviewDialogProps: LnkResultPreviewDialogProps | null
}

export function ReportLnkDialogs({
  requestDialogProps,
  requestManagerDialogProps,
  resultManagerDialogProps,
  officialityDialogProps,
  resultDialogProps,
  resultPreviewDialogProps,
}: ReportLnkDialogsProps) {
  return (
    <>
      {requestDialogProps ? <LnkRequestDialog {...requestDialogProps} /> : null}
      {requestManagerDialogProps ? <LnkRequestManagerDialog {...requestManagerDialogProps} /> : null}
      {resultManagerDialogProps ? <LnkResultManagerDialog {...resultManagerDialogProps} /> : null}
      {officialityDialogProps ? <LnkOfficialityDialog {...officialityDialogProps} /> : null}
      {resultDialogProps ? <LnkResultDialog {...resultDialogProps} /> : null}
      {resultPreviewDialogProps ? <LnkResultPreviewDialog {...resultPreviewDialogProps} /> : null}
    </>
  )
}
