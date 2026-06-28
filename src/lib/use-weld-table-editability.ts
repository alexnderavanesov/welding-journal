import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

type WeldTableRow = WeldRow

type UseWeldTableEditabilityParams = {
  onEdit?: (row: WeldTableRow, fieldKey?: WeldFieldKey) => void
  readOnly: boolean
  editableFieldKeys: ReadonlySet<WeldFieldKey>
  blockedFieldKeys: ReadonlySet<WeldFieldKey>
  isCellEditable: (row: WeldTableRow, fieldKey: WeldFieldKey) => boolean
}

export function useWeldTableEditability({
  onEdit,
  readOnly,
  editableFieldKeys,
  blockedFieldKeys,
  isCellEditable,
}: UseWeldTableEditabilityParams) {
  function canEditField(fieldKey: WeldFieldKey) {
    if (!onEdit) return false
    if (!readOnly) return !blockedFieldKeys.has(fieldKey)
    return editableFieldKeys.has(fieldKey)
  }

  function canEditCell(row: WeldTableRow, fieldKey: WeldFieldKey) {
    return canEditField(fieldKey) && isCellEditable(row, fieldKey)
  }

  return { canEditField, canEditCell }
}
