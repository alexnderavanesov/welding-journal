import type { ReportFieldEditorProps } from '@/components/report-field-editor'
import type { HeatTreatmentFieldEditingState } from '@/lib/home-state'

type FieldDialogProps = NonNullable<ReportFieldEditorProps['dialogProps']>

type CreateReportFieldEditorPropsOptions = {
  editing: HeatTreatmentFieldEditingState | null
  requestOptions: FieldDialogProps['requestOptions']
  isSaving: boolean
  onChange: FieldDialogProps['onChange']
  onClose: FieldDialogProps['onClose']
  onSave: FieldDialogProps['onSave']
}

export function createReportFieldEditorProps({
  editing,
  requestOptions,
  isSaving,
  onChange,
  onClose,
  onSave,
}: CreateReportFieldEditorPropsOptions): ReportFieldEditorProps {
  return {
    dialogProps: editing
      ? {
          editing,
          requestOptions,
          isSaving,
          onChange,
          onClose,
          onSave,
        }
      : null,
  }
}
