import { PstoRequestDialog, type PstoRequestDialogProps } from '@/components/psto-request-dialog'
import {
  PstoRequestManagerDialog,
  type PstoRequestManagerDialogProps,
} from '@/components/psto-request-manager-dialog'
import { PstoResultDialog, type PstoResultDialogProps } from '@/components/psto-result-dialog'
import {
  PstoResultManagerDialog,
  type PstoResultManagerDialogProps,
} from '@/components/psto-result-manager-dialog'

export type ReportPstoDialogsProps = {
  requestDialogProps: PstoRequestDialogProps | null
  requestManagerDialogProps: PstoRequestManagerDialogProps | null
  resultDialogProps: PstoResultDialogProps | null
  resultManagerDialogProps: PstoResultManagerDialogProps | null
}

export function ReportPstoDialogs({
  requestDialogProps,
  requestManagerDialogProps,
  resultDialogProps,
  resultManagerDialogProps,
}: ReportPstoDialogsProps) {
  return (
    <>
      {requestDialogProps ? <PstoRequestDialog {...requestDialogProps} /> : null}
      {requestManagerDialogProps ? <PstoRequestManagerDialog {...requestManagerDialogProps} /> : null}
      {resultDialogProps ? <PstoResultDialog {...resultDialogProps} /> : null}
      {resultManagerDialogProps ? <PstoResultManagerDialog {...resultManagerDialogProps} /> : null}
    </>
  )
}
