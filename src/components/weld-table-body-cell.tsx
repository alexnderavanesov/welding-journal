import { WeldTableValue } from '@/components/weld-table-value'
import type { WeldRow } from '@/lib/dispatcher-types'
import { bodyCellClass } from '@/lib/weld-table-utils'
import { getFinalStatusErrorReason, type WeldField, type WeldFieldKey } from '@/lib/weld-fields'
import { formatFinalStatusDisplay } from '@/lib/weld-status'
import { getStickyWeldTableFieldStyle, isStickyWeldTableField } from '@/lib/weld-table-sticky-columns'

const SYSTEM_FIELD_TOOLTIP =
  'Системное поле: заполняется через связанные окна ЛНК/ПСТО, заявки, результаты, заключения или другие действия системы.'

type WeldTableBodyCellProps = {
  row: WeldRow
  field: WeldField
  displayValue: unknown
  isEditableCell: boolean
  isBlockedEditableCell: boolean
  isHighlightedRow: boolean
  isHighlightedCell: boolean
  isResultField: boolean
  stickyLeft: number
  stickyIdentityLeadingWidth: number
  stickyIdentityColumns: boolean
  stickyBackgroundClassName: string
  isSectionEnd: boolean
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
  stickyLeft,
  stickyIdentityLeadingWidth,
  stickyIdentityColumns,
  stickyBackgroundClassName,
  isSectionEnd,
  onEdit,
}: WeldTableBodyCellProps) {
  const finalStatusErrorReason =
    field.key === 'finalStatus' && String(displayValue ?? '').trim().toLowerCase() === 'ошибка' ? getFinalStatusErrorReason(row) : null
  const visibleValue = field.key === 'finalStatus' ? formatFinalStatusDisplay(row, displayValue) : displayValue
  const isStickyCell = stickyIdentityColumns && isStickyWeldTableField(field.key)
  const contentClass = `block h-full min-h-10 w-full border-0 bg-transparent px-3 py-2.5 text-center text-[13px] font-normal text-slate-700 ${
    isEditableCell ? 'cursor-pointer hover:bg-[#dff1fb]' : isResultField ? '' : 'text-slate-600'
  }`

  return (
    <td
      className={`${bodyCellClass(field.key, !isEditableCell, isHighlightedRow, isHighlightedCell, isBlockedEditableCell, isSectionEnd)} ${
        isStickyCell
          ? getStickyWeldTableBodyCellClass({
              isHighlightedRow,
              isHighlightedCell,
              isBlockedEditableCell,
              stickyBackgroundClassName,
            })
          : ''
      }`}
      style={isStickyCell ? getStickyWeldTableFieldStyle(field.key, stickyLeft, stickyIdentityLeadingWidth) : undefined}
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
            ? 'Недоступно: отсутствует отметка "да" в назначении соответствующего контроля'
            : SYSTEM_FIELD_TOOLTIP
      }
    >
      <div className={contentClass}>
        <WeldTableValue field={field} value={visibleValue} isResultField={isResultField} />
      </div>
    </td>
  )
}

function getStickyWeldTableBodyCellClass({
  isHighlightedRow,
  isHighlightedCell,
  isBlockedEditableCell,
  stickyBackgroundClassName,
}: {
  isHighlightedRow: boolean
  isHighlightedCell: boolean
  isBlockedEditableCell: boolean
  stickyBackgroundClassName: string
}) {
  const background = isHighlightedCell
    ? 'bg-lime-100/95'
    : isHighlightedRow
      ? 'bg-emerald-50 group-hover:bg-emerald-50'
      : isBlockedEditableCell
        ? 'bg-amber-50 group-hover:bg-[#dff1fb]'
        : stickyBackgroundClassName
  return `sticky z-[1] ${background}`
}
