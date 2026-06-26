import type { ComponentProps } from 'react'
import { ReportFieldEditDialog } from '@/components/report-field-edit-dialog'

type ReportFieldEditDialogProps = ComponentProps<typeof ReportFieldEditDialog>

type ReportFieldEditorProps = {
  dialogProps: ReportFieldEditDialogProps | null
}

export function ReportFieldEditor({ dialogProps }: ReportFieldEditorProps) {
  if (!dialogProps) return null

  return <ReportFieldEditDialog {...dialogProps} />
}
