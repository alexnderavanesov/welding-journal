import type { ComponentProps } from 'react'
import { PstoWeldLineMoveDialog } from '@/components/psto-weld-line-move-dialog'
import { WeldForm } from '@/components/weld-form'

type WeldFormProps = ComponentProps<typeof WeldForm>

export type ReportWeldEditorProps = {
  formKey: string | null
  formProps: WeldFormProps | null
  moveDialogProps?: ComponentProps<typeof PstoWeldLineMoveDialog> | null
}

export function ReportWeldEditor({ formKey, formProps, moveDialogProps }: ReportWeldEditorProps) {
  if (!formProps || !formKey) return null

  return (
    <>
      <WeldForm key={formKey} {...formProps} />
      {moveDialogProps ? <PstoWeldLineMoveDialog {...moveDialogProps} /> : null}
    </>
  )
}
