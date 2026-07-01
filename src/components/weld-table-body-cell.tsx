import { WeldTableValue } from '@/components/weld-table-value'
import type { WeldRow } from '@/lib/dispatcher-types'
import { bodyCellClass } from '@/lib/weld-table-utils'
import { getFinalStatusErrorReason, type WeldField, type WeldFieldKey } from '@/lib/weld-fields'

type WeldTableBodyCellProps = {
  row: WeldRow
  field: WeldField
  displayValue: unknown
  isEditableCell: boolean
  isBlockedEditableCell: boolean
  isHighlightedRow: boolean
  isHighlightedCell: boolean
  isResultField: boolean
  onEdit?: (row: WeldRow, fieldKey?: WeldFieldKey) => void
}

export function WeldTableBodyCell({
  row,
  field,
  displayValue,
  isEditableCell,
  isBlockedEditableCell,
  isHighlightedRow,
  isHighlightedCell,
  isResultField,
  onEdit,
}: WeldTableBodyCellProps) {
  const finalStatusErrorReason =
    field.key === 'finalStatus' && String(displayValue ?? '').trim().toLowerCase() === 'ошибка' ? getFinalStatusErrorReason(row) : null
  const contentClass = `block h-full min-h-10 w-full border-0 bg-transparent px-3 py-2.5 text-center text-[13px] font-normal text-slate-700 ${
    isEditableCell ? 'cursor-pointer hover:bg-slate-100/70' : isResultField ? '' : 'text-slate-500'
  }`

  return (
    <td
      className={bodyCellClass(field.key, !isEditableCell, isHighlightedRow, isHighlightedCell, isBlockedEditableCell)}
      onClick={(event) => {
        if (!isEditableCell) return
        event.stopPropagation()
        onEdit?.(row, field.key as WeldFieldKey)
      }}
      title={
        finalStatusErrorReason
          ? finalStatusErrorReason
          : isEditableCell
          ? 'Нажмите, чтобы редактировать поле'
          : isBlockedEditableCell
            ? 'Недоступно: отсутствует отметка "да" в соответствующем наличии'
            : undefined
      }
    >
      <div className={contentClass}>
        <WeldTableValue field={field} value={displayValue} isResultField={isResultField} />
      </div>
    </td>
  )
}
