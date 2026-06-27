import { ReportChainDialog, type ReportChainDialogProps } from '@/components/report-chain-dialog'
import { ReportFieldEditor, type ReportFieldEditorProps } from '@/components/report-field-editor'
import { ReportLnkDialogs, type ReportLnkDialogsProps } from '@/components/report-lnk-dialogs'
import { ReportPstoDialogs, type ReportPstoDialogsProps } from '@/components/report-psto-dialogs'
import { ReportWeldEditor, type ReportWeldEditorProps } from '@/components/report-weld-editor'

type ReportDialogsProps = {
  chainDialogProps: ReportChainDialogProps
  weldEditorProps: ReportWeldEditorProps
  pstoDialogsProps: ReportPstoDialogsProps
  lnkDialogsProps: ReportLnkDialogsProps
  fieldEditorProps: ReportFieldEditorProps
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
