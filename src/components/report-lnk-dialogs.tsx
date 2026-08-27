import { DuplicateControlDialog, type DuplicateControlDialogProps } from '@/components/duplicate-control-dialog'
import { LnkOfficialityDialog, type LnkOfficialityDialogProps } from '@/components/lnk-officiality-dialog'
import { LnkRequestDialog, type LnkRequestDialogProps } from '@/components/lnk-request-dialog'
import { LnkRequestManagerDialog, type LnkRequestManagerDialogProps } from '@/components/lnk-request-manager-dialog'
import { LnkResultDialog, type LnkResultDialogProps } from '@/components/lnk-result-dialog'
import { LnkResultManagerDialog, type LnkResultManagerDialogProps } from '@/components/lnk-result-manager-dialog'

export type ReportLnkDialogsProps = {
  requestDialogProps: LnkRequestDialogProps | null
  requestManagerDialogProps: LnkRequestManagerDialogProps | null
  resultManagerDialogProps: LnkResultManagerDialogProps | null
  officialityDialogProps: LnkOfficialityDialogProps | null
  duplicateControlDialogProps: DuplicateControlDialogProps | null
  resultDialogProps: LnkResultDialogProps | null
}

export function ReportLnkDialogs({
  requestDialogProps,
  requestManagerDialogProps,
  resultManagerDialogProps,
  officialityDialogProps,
  duplicateControlDialogProps,
  resultDialogProps,
}: ReportLnkDialogsProps) {
  return (
    <>
      {requestDialogProps ? <LnkRequestDialog {...requestDialogProps} /> : null}
      {requestManagerDialogProps ? <LnkRequestManagerDialog {...requestManagerDialogProps} /> : null}
      {resultManagerDialogProps ? <LnkResultManagerDialog {...resultManagerDialogProps} /> : null}
      {officialityDialogProps ? <LnkOfficialityDialog {...officialityDialogProps} /> : null}
      {duplicateControlDialogProps ? <DuplicateControlDialog {...duplicateControlDialogProps} /> : null}
      {resultDialogProps ? <LnkResultDialog {...resultDialogProps} /> : null}
    </>
  )
}
