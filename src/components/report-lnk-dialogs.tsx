import type { ComponentProps } from 'react'
import { LnkOfficialityDialog } from '@/components/lnk-officiality-dialog'
import { LnkRequestDialog } from '@/components/lnk-request-dialog'
import { LnkRequestManagerDialog } from '@/components/lnk-request-manager-dialog'
import { LnkResultDialog } from '@/components/lnk-result-dialog'
import { LnkResultManagerDialog } from '@/components/lnk-result-manager-dialog'
import { LnkResultPreviewDialog } from '@/components/lnk-result-preview-dialog'

type LnkRequestDialogProps = ComponentProps<typeof LnkRequestDialog>
type LnkRequestManagerDialogProps = ComponentProps<typeof LnkRequestManagerDialog>
type LnkResultManagerDialogProps = ComponentProps<typeof LnkResultManagerDialog>
type LnkOfficialityDialogProps = ComponentProps<typeof LnkOfficialityDialog>
type LnkResultDialogProps = ComponentProps<typeof LnkResultDialog>
type LnkResultPreviewDialogProps = ComponentProps<typeof LnkResultPreviewDialog>

type ReportLnkDialogsProps = {
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
