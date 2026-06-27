import { WeldTableValue } from '@/components/weld-table-value'
import { bodyCellClass } from '@/lib/weld-table-utils'
import type { WeldField, WeldFieldKey, WeldInput } from '@/lib/weld-fields'

type WeldTableBodyCellProps = {
  row: WeldInput & { id: number }
  field: WeldField
  displayValue: unknown
  isEditableCell: boolean
  isBlockedEditableCell: boolean
  isHighlightedRow: boolean
  isHighlightedCell: boolean
  isResultField: boolean
  onEdit?: (row: WeldInput & { id: number }, fieldKey?: WeldFieldKey) => void
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
        isEditableCell
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
