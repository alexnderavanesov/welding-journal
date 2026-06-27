import type { ReportWeldEditorProps } from '@/components/report-weld-editor'
import type { EditingState } from '@/lib/home-state'

type WeldFormProps = NonNullable<ReportWeldEditorProps['formProps']>

type CreateReportWeldEditorPropsOptions = {
  editing: EditingState | null
  stampSelectOptions: WeldFormProps['stampSelectOptions']
  getExternalSaveBlockReason: WeldFormProps['getExternalSaveBlockReason']
  isSaving: boolean
  onCancel: WeldFormProps['onCancel']
  onSave: WeldFormProps['onSave']
}

export function createReportWeldEditorProps({
  editing,
  stampSelectOptions,
  getExternalSaveBlockReason,
  isSaving,
  onCancel,
  onSave,
}: CreateReportWeldEditorPropsOptions): ReportWeldEditorProps {
  return {
    formKey: editing ? `${editing.record.id ?? 'new'}:${editing.focusField ?? 'form'}` : null,
    formProps: editing
      ? {
          value: editing.record,
          focusField: editing.focusField,
          stampSelectOptions,
          getExternalSaveBlockReason,
          busy: isSaving,
          onCancel,
          onSave,
        }
      : null,
  }
}
