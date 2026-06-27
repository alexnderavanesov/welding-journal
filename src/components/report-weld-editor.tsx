import type { ComponentProps } from 'react'
import { WeldForm } from '@/components/weld-form'

type WeldFormProps = ComponentProps<typeof WeldForm>

export type ReportWeldEditorProps = {
  formKey: string | null
  formProps: WeldFormProps | null
}

export function ReportWeldEditor({ formKey, formProps }: ReportWeldEditorProps) {
  if (!formProps || !formKey) return null

  return <WeldForm key={formKey} {...formProps} />
}
