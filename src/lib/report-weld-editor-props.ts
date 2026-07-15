import type { ReportWeldEditorProps } from '@/components/report-weld-editor'
import type { EditingState } from '@/lib/home-state'
import type { WeldInput } from '@/lib/weld-fields'

type WeldFormProps = NonNullable<ReportWeldEditorProps['formProps']>

type CreateReportWeldEditorPropsOptions = {
  editing: EditingState | null
  rows: readonly WeldInput[]
  stampSelectOptions: WeldFormProps['stampSelectOptions']
  getExternalSaveBlockReason: WeldFormProps['getExternalSaveBlockReason']
  isSaving: boolean
  onCancel: WeldFormProps['onCancel']
  onSave: WeldFormProps['onSave']
}

export function createReportWeldEditorProps({
  editing,
  rows,
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
          suggestionRows: rows,
          stampSelectOptions,
          getExternalSaveBlockReason,
          busy: isSaving,
          onCancel,
          onSave,
        }
      : null,
  }
}
