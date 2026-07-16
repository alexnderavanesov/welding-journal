import { WeldTableRowActions, WeldTableRowNavigation } from '@/components/weld-table-actions'
import { WeldTableBodyCell } from '@/components/weld-table-body-cell'
import { WeldTableEditActionsCell } from '@/components/weld-table-edit-actions-cell'
import { WeldTableEmptyRow } from '@/components/weld-table-empty-row'
import { WeldTableRowSelectCell } from '@/components/weld-table-row-select-cell'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ReportRowActions } from '@/lib/report-row-actions'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import type { WeldTableDisplaySection } from '@/lib/weld-table-sections'
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
  onOpenChain?: (row: WeldRow) => void
  onFilterLine?: (row: WeldRow) => void
  onOpenLinkedReport?: (row: WeldRow) => void
  openLinkedReportTitle: string
  hasRowActions: boolean
  rowActions?: ReportRowActions
  extraColumns: WeldTableExtraColumn[]
  duplicateKeys: ReadonlySet<string>
  highlightedRowIds: ReadonlySet<number>
  highlightedCellKeys: ReadonlySet<string>
  canEditField: (fieldKey: WeldFieldKey) => boolean
  canEditCell: (row: WeldRow, fieldKey: WeldFieldKey) => boolean
  stickyLeft: number
  stickyIdentityLeadingWidth: number
  stickyIdentityColumns: boolean
  getDisplayValue: (row: WeldRow, fieldKey: WeldFieldKey) => unknown
  onEdit?: (row: WeldRow, fieldKey?: WeldFieldKey) => void
  onDelete?: (id: number) => void
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
  onOpenChain,
  onFilterLine,
  onOpenLinkedReport,
  openLinkedReportTitle,
  hasRowActions,
  rowActions,
  extraColumns,
  duplicateKeys,
  highlightedRowIds,
  highlightedCellKeys,
  canEditField,
  canEditCell,
  stickyLeft,
  stickyIdentityLeadingWidth,
  stickyIdentityColumns,
  getDisplayValue,
  onEdit,
  onDelete,
}: WeldTableBodyRowsProps) {
  const trailingExtraColumns = getTrailingExtraColumns(extraColumns, sections)

  if (rows.length === 0) {
    return <WeldTableEmptyRow colSpan={colSpan} />
  }

  return (
    <>
      {rows.map((row, rowIndex) => {
        const isDuplicate = duplicateKeys.has(getDuplicateKey(row) ?? '')
        const isHighlighted = highlightedRowIds.has(row.id)
        const isSelected = selectedRowIds.has(row.id)
        const isSelectableRow = !selectable || isRowSelectable(row)
        const stickyBackgroundClassName = getWeldTableStickyCellBackgroundClassName({
          rowIndex,
          isHighlighted,
          isSelected,
          isDuplicate,
        })

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
                sticky={stickyIdentityColumns}
                stickyLeft={stickyLeft}
                stickyBackgroundClassName={stickyBackgroundClassName}
                onOpenChain={onOpenChain}
                onFilterLine={onFilterLine}
                onOpenLinkedReport={onOpenLinkedReport}
                openLinkedReportTitle={openLinkedReportTitle}
              />
            ) : null}
            {hasRowActions && rowActions ? <WeldTableRowActions row={row} rowActions={rowActions} /> : null}
            {sections.flatMap((section) => [
              ...extraColumns
                .filter((column) => column.insertBeforeSection === section.section)
                .map((column) => <ExtraBodyCell key={column.key} column={column} row={row} />),
              ...section.fields.map((field, fieldIndex) => {
                const isEditableColumn = canEditField(field.key)
                const isEditableCell = canEditCell(row, field.key)
                const isBlockedEditableCell = isEditableColumn && !isEditableCell
                const isCellHighlighted = highlightedCellKeys.has(getCellKey(row.id, field.key))
                const isResultField = RESULT_FIELD_KEYS.has(field.key as WeldFieldKey)
                const displayValue = getDisplayValue(row, field.key)
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
