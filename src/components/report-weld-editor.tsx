import { useAccess } from '@/lib/security-context'
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
  const { can } = useAccess()
  if (!formProps || !formKey) return null

  return (
    <>
      <WeldForm key={formKey} {...formProps} closureAccess={can('welding.view') && can('closures.view') ? can('closures.edit') ? 'edit' : 'view' : undefined} />
      {moveDialogProps ? <PstoWeldLineMoveDialog {...moveDialogProps} /> : null}
    </>
  )
}
