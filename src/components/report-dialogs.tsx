import type { ComponentProps } from 'react'
import { ReportChainDialog } from '@/components/report-chain-dialog'
import { ReportFieldEditor } from '@/components/report-field-editor'
import { ReportLnkDialogs } from '@/components/report-lnk-dialogs'
import { ReportPstoDialogs } from '@/components/report-psto-dialogs'
import { ReportWeldEditor } from '@/components/report-weld-editor'

type ReportDialogsProps = {
  chainDialogProps: ComponentProps<typeof ReportChainDialog>
  weldEditorProps: ComponentProps<typeof ReportWeldEditor>
  pstoDialogsProps: ComponentProps<typeof ReportPstoDialogs>
  lnkDialogsProps: ComponentProps<typeof ReportLnkDialogs>
  fieldEditorProps: ComponentProps<typeof ReportFieldEditor>
}

export function ReportDialogs({
  chainDialogProps,
  weldEditorProps,
  pstoDialogsProps,
  lnkDialogsProps,
  fieldEditorProps,
}: ReportDialogsProps) {
  return (
    <>
      <ReportChainDialog {...chainDialogProps} />
      <ReportWeldEditor {...weldEditorProps} />
      <ReportPstoDialogs {...pstoDialogsProps} />
      <ReportLnkDialogs {...lnkDialogsProps} />
      <ReportFieldEditor {...fieldEditorProps} />
    </>
  )
}
