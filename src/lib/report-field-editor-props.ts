import type { ReportFieldEditorProps } from '@/components/report-field-editor'
import type { HeatTreatmentFieldEditingState } from '@/lib/home-state'

type FieldDialogProps = NonNullable<ReportFieldEditorProps['dialogProps']>

type CreateReportFieldEditorPropsOptions = {
  editing: HeatTreatmentFieldEditingState | null
  requestOptions: FieldDialogProps['requestOptions']
  isSaving: boolean
  isContextReady?: boolean
  onChange: FieldDialogProps['onChange']
  onClose: FieldDialogProps['onClose']
  onSave: FieldDialogProps['onSave']
}

export function createReportFieldEditorProps({
  editing,
  requestOptions,
  isSaving,
  isContextReady,
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
          isContextReady,
          onChange,
          onClose,
          onSave,
        }
      : null,
  }
}
