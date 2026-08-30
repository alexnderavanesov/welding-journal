import type { ReportWeldEditorProps } from '@/components/report-weld-editor'
import type { EditingState } from '@/lib/home-state'
import type { WeldInput } from '@/lib/weld-fields'

type WeldFormProps = NonNullable<ReportWeldEditorProps['formProps']>

type CreateReportWeldEditorPropsOptions = {
  editing: EditingState | null
  suggestionRows?: readonly WeldInput[]
  stampSelectOptions: WeldFormProps['stampSelectOptions']
  getExternalSaveBlockReason: WeldFormProps['getExternalSaveBlockReason']
  onLineIdentityChange?: WeldFormProps['onLineIdentityChange']
  preSaveDecision?: WeldFormProps['preSaveDecision']
  isSaving: boolean
  onCancel: WeldFormProps['onCancel']
  onSave: WeldFormProps['onSave']
  moveDialogProps?: ReportWeldEditorProps['moveDialogProps']
}

export function createReportWeldEditorProps({
  editing,
  suggestionRows,
  stampSelectOptions,
  getExternalSaveBlockReason,
  onLineIdentityChange,
  preSaveDecision,
  isSaving,
  onCancel,
  onSave,
  moveDialogProps,
}: CreateReportWeldEditorPropsOptions): ReportWeldEditorProps {
  return {
    formKey: editing ? `${editing.record.id ?? 'new'}:${editing.focusField ?? 'form'}` : null,
    formProps: editing
      ? {
          value: editing.record,
          focusField: editing.focusField,
          returnPageScrollPosition: editing.returnPageScrollPosition,
          suggestionRows,
          stampSelectOptions,
          getExternalSaveBlockReason,
          onLineIdentityChange,
          preSaveDecision,
          busy: isSaving,
          onCancel,
          onSave,
        }
      : null,
    moveDialogProps: editing ? moveDialogProps ?? null : null,
  }
}
