import { WeldTableRowActions, WeldTableRowNavigation } from '@/components/weld-table-actions'
import { WeldTableBodyCell } from '@/components/weld-table-body-cell'
import { WeldTableEditActionsCell } from '@/components/weld-table-edit-actions-cell'
import { WeldTableEmptyRow } from '@/components/weld-table-empty-row'
import { WeldTableRowSelectCell } from '@/components/weld-table-row-select-cell'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ReportRowActions } from '@/lib/report-row-actions'
import { getWeldTableRowClassName, getWeldTableRowTitle } from '@/lib/weld-table-row-state'
import { getCellKey, getDuplicateKey } from '@/lib/weld-table-utils'
import { RESULT_FIELD_KEYS, type WeldField, type WeldFieldKey } from '@/lib/weld-fields'

type WeldTableBodyRowsProps = {
  rows: WeldRow[]
  fields: WeldField[]
  colSpan: number
  readOnly: boolean
  selectable: boolean
  selectedRowIds: ReadonlySet<number>
  onSetRowSelected: (row: WeldRow, selected: boolean) => void
  isRowSelectable: (row: WeldRow) => boolean
  hasChainAction: boolean
  onOpenChain?: (row: WeldRow) => void
  onOpenLinkedReport?: (row: WeldRow) => void
  openLinkedReportTitle: string
  hasRowActions: boolean
  rowActions?: ReportRowActions
  duplicateKeys: ReadonlySet<string>
  highlightedRowIds: ReadonlySet<number>
  highlightedCellKeys: ReadonlySet<string>
  canEditField: (fieldKey: WeldFieldKey) => boolean
  canEditCell: (row: WeldRow, fieldKey: WeldFieldKey) => boolean
  getDisplayValue: (row: WeldRow, fieldKey: WeldFieldKey) => unknown
  onEdit?: (row: WeldRow, fieldKey?: WeldFieldKey) => void
  onDelete?: (id: number) => void
}

export function WeldTableBodyRows({
  rows,
  fields,
  colSpan,
  readOnly,
  selectable,
  selectedRowIds,
  onSetRowSelected,
  isRowSelectable,
  hasChainAction,
  onOpenChain,
  onOpenLinkedReport,
  openLinkedReportTitle,
  hasRowActions,
  rowActions,
  duplicateKeys,
  highlightedRowIds,
  highlightedCellKeys,
  canEditField,
  canEditCell,
  getDisplayValue,
  onEdit,
  onDelete,
}: WeldTableBodyRowsProps) {
  if (rows.length === 0) {
    return <WeldTableEmptyRow colSpan={colSpan} />
  }

  return (
    <>
      {rows.map((row) => {
        const isDuplicate = duplicateKeys.has(getDuplicateKey(row) ?? '')
        const isHighlighted = highlightedRowIds.has(row.id)
        const isSelected = selectedRowIds.has(row.id)
        const isSelectableRow = !selectable || isRowSelectable(row)

        return (
          <tr
            key={row.id}
            className={getWeldTableRowClassName({ readOnly, isHighlighted, isSelected, isDuplicate })}
            title={getWeldTableRowTitle({ isHighlighted, isDuplicate })}
          >
            {selectable ? (
              <WeldTableRowSelectCell
                label={String(row.joint ?? row.id)}
                checked={isSelectableRow && isSelected}
                disabled={!isSelectableRow}
                onChange={(selected) => onSetRowSelected(row, selected)}
              />
            ) : null}
            {hasChainAction ? (
              <WeldTableRowNavigation
                row={row}
                onOpenChain={onOpenChain}
                onOpenLinkedReport={onOpenLinkedReport}
                openLinkedReportTitle={openLinkedReportTitle}
              />
            ) : null}
            {hasRowActions && rowActions ? <WeldTableRowActions row={row} rowActions={rowActions} /> : null}
            {fields.map((field) => {
              const isEditableColumn = canEditField(field.key)
              const isEditableCell = canEditCell(row, field.key)
              const isBlockedEditableCell = isEditableColumn && !isEditableCell
              const isCellHighlighted = highlightedCellKeys.has(getCellKey(row.id, field.key))
              const isResultField = RESULT_FIELD_KEYS.has(field.key as WeldFieldKey)
              const displayValue = getDisplayValue(row, field.key)

              return (
                <WeldTableBodyCell
                  key={field.key}
                  row={row}
                  field={field}
                  displayValue={displayValue}
                  isEditableCell={isEditableCell}
                  isBlockedEditableCell={isBlockedEditableCell}
                  isHighlightedRow={isHighlighted}
                  isHighlightedCell={isCellHighlighted}
                  isResultField={isResultField}
                  onEdit={onEdit}
                />
              )
            })}
            {!readOnly ? <WeldTableEditActionsCell row={row} onEdit={onEdit} onDelete={onDelete} /> : null}
          </tr>
        )
      })}
    </>
  )
}
