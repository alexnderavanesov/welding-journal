import { WeldTableRowActions } from '@/components/weld-table-actions'
import { WeldTableBodyCell } from '@/components/weld-table-body-cell'
import { WeldTableEditActionsCell } from '@/components/weld-table-edit-actions-cell'
import { WeldTableEmptyRow } from '@/components/weld-table-empty-row'
import { WeldTableRowSelectCell } from '@/components/weld-table-row-select-cell'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ReportRowActions } from '@/lib/report-row-actions'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import type { WeldTableDisplaySection } from '@/lib/weld-table-sections'
import type { MouseEvent } from 'react'
import {
  getWeldTableRowClassName,
  getWeldTableRowTitle,
  getWeldTableStickyCellBackgroundClassName,
} from '@/lib/weld-table-row-state'
import { getCellKey, getDuplicateKey } from '@/lib/weld-table-utils'
import { RESULT_FIELD_KEYS, type WeldFieldKey } from '@/lib/weld-fields'

type WeldTableBodyRowsProps = {
  rows: WeldRow[]
  sections: WeldTableDisplaySection[]
  colSpan: number
  readOnly: boolean
  selectable: boolean
  selectedRowIds: ReadonlySet<number>
  onSetRowSelected: (row: WeldRow, selected: boolean) => void
  isRowSelectable: (row: WeldRow) => boolean
  hasChainAction: boolean
  hasRowActions: boolean
  rowActions?: ReportRowActions
  extraColumns: WeldTableExtraColumn[]
  duplicateKeys: ReadonlySet<string>
  highlightedRowIds: ReadonlySet<number>
  highlightedCellKeys: ReadonlySet<string>
  dispatcherTaskRowIds: ReadonlySet<number>
  canEditField: (fieldKey: WeldFieldKey) => boolean
  canEditCell: (row: WeldRow, fieldKey: WeldFieldKey) => boolean
  stickyLeft: number
  stickyIdentityLeadingWidth: number
  stickyIdentityColumns: boolean
  getDisplayValue: (row: WeldRow, fieldKey: WeldFieldKey) => unknown
  onEdit?: (row: WeldRow, fieldKey?: WeldFieldKey) => void
  onDelete?: (id: number) => void
  onContextMenu?: (event: MouseEvent, row: WeldRow) => void
}

export function WeldTableBodyRows({
  rows,
  sections,
  colSpan,
  readOnly,
  selectable,
  selectedRowIds,
  onSetRowSelected,
  isRowSelectable,
  hasChainAction,
  hasRowActions,
  rowActions,
  extraColumns,
  duplicateKeys,
  highlightedRowIds,
  highlightedCellKeys,
  dispatcherTaskRowIds,
  canEditField,
  canEditCell,
  stickyLeft,
  stickyIdentityLeadingWidth,
  stickyIdentityColumns,
  getDisplayValue,
  onEdit,
  onDelete,
  onContextMenu,
}: WeldTableBodyRowsProps) {
  const trailingExtraColumns = getTrailingExtraColumns(extraColumns, sections)
  const hasControlColumn = selectable || hasChainAction

  if (rows.length === 0) {
    return <WeldTableEmptyRow colSpan={colSpan} />
  }

  return (
    <>
      {rows.map((row, rowIndex) => {
        const isDuplicate = duplicateKeys.has(getDuplicateKey(row) ?? '')
        const isHighlighted = highlightedRowIds.has(row.id)
        const isSelected = selectedRowIds.has(row.id)
        const hasDispatcherTask = dispatcherTaskRowIds.has(row.id)
        const isSelectableRow = !selectable || isRowSelectable(row)
        const stickyBackgroundClassName = getWeldTableStickyCellBackgroundClassName({
          rowIndex,
          isHighlighted,
          isSelected,
          isDuplicate,
          hasDispatcherTask,
        })

        return (
          <tr
            key={row.id}
            className={getWeldTableRowClassName({ readOnly, isHighlighted, isSelected, isDuplicate, hasDispatcherTask })}
            title={getWeldTableRowTitle({ isHighlighted, isDuplicate, hasDispatcherTask })}
            onContextMenu={onContextMenu ? (event) => onContextMenu(event, row) : undefined}
          >
            {hasControlColumn ? (
              <WeldTableRowSelectCell
                selectable={selectable}
                label={String(row.joint ?? row.id)}
                checked={isSelectableRow && isSelected}
                disabled={!isSelectableRow}
                sticky={stickyIdentityColumns}
                stickyLeft={stickyLeft}
                stickyBackgroundClassName={stickyBackgroundClassName}
                onChange={(selected) => onSetRowSelected(row, selected)}
              />
            ) : null}
            {hasRowActions && rowActions ? <WeldTableRowActions row={row} rowActions={rowActions} /> : null}
            {sections.flatMap((section) => [
              ...extraColumns
                .filter((column) => column.insertBeforeSection === section.section)
                .map((column) => <ExtraBodyCell key={column.key} column={column} row={row} />),
              ...section.fields.map((field, fieldIndex) => {
                const fieldKey = field.key as WeldFieldKey
                const isEditableColumn = canEditField(fieldKey)
                const isEditableCell = canEditCell(row, fieldKey)
                const isBlockedEditableCell = isEditableColumn && !isEditableCell
                const isCellHighlighted = highlightedCellKeys.has(getCellKey(row.id, field.key))
                const isResultField = RESULT_FIELD_KEYS.has(fieldKey)
                const displayValue = getDisplayValue(row, fieldKey)
                const isSectionEnd = fieldIndex === section.fields.length - 1

                return (
                  <WeldTableBodyCell
                    key={field.key}
                    row={row}
                    field={field}
                    displayValue={displayValue}
                    isEditableCell={isEditableCell}
                    isBlockedEditableCell={isBlockedEditableCell}
                    isHighlightedRow={isHighlighted}
                    isSelectedRow={isSelected}
                    hasDispatcherTask={hasDispatcherTask}
                    isHighlightedCell={isCellHighlighted}
                    isResultField={isResultField}
                    stickyLeft={stickyLeft}
                    stickyIdentityLeadingWidth={stickyIdentityLeadingWidth}
                    stickyIdentityColumns={stickyIdentityColumns}
                    stickyBackgroundClassName={stickyBackgroundClassName}
                    isSectionEnd={isSectionEnd}
                    onEdit={onEdit}
                  />
                )
              }),
            ])}
            {trailingExtraColumns.map((column) => (
              <ExtraBodyCell key={column.key} column={column} row={row} />
            ))}
            {!readOnly ? <WeldTableEditActionsCell row={row} onEdit={onEdit} onDelete={onDelete} /> : null}
          </tr>
        )
      })}
    </>
  )
}

function ExtraBodyCell({ column, row }: { column: WeldTableExtraColumn; row: WeldRow }) {
  return (
    <td className="border-b border-r border-b-slate-100 border-r-slate-200 bg-slate-50/80 p-0 align-top">
      {column.renderCell(row)}
    </td>
  )
}

function getTrailingExtraColumns(columns: WeldTableExtraColumn[], sections: WeldTableDisplaySection[]) {
  const sectionNames = new Set(sections.map((section) => section.section))
  return columns.filter((column) => !column.insertBeforeSection || !sectionNames.has(column.insertBeforeSection))
}
