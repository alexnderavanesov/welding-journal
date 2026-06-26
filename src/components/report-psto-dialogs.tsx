import type { ComponentProps } from 'react'
import { PstoRequestDialog } from '@/components/psto-request-dialog'
import { PstoRequestManagerDialog } from '@/components/psto-request-manager-dialog'
import { PstoResultDialog } from '@/components/psto-result-dialog'
import { PstoResultManagerDialog } from '@/components/psto-result-manager-dialog'

type PstoRequestDialogProps = ComponentProps<typeof PstoRequestDialog>
type PstoRequestManagerDialogProps = ComponentProps<typeof PstoRequestManagerDialog>
type PstoResultDialogProps = ComponentProps<typeof PstoResultDialog>
type PstoResultManagerDialogProps = ComponentProps<typeof PstoResultManagerDialog>

type ReportPstoDialogsProps = {
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
