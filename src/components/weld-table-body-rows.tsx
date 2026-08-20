import { WeldTableRowActions } from '@/components/weld-table-actions'
import { WeldTableBodyCell } from '@/components/weld-table-body-cell'
import { WeldTableEditActionsCell } from '@/components/weld-table-edit-actions-cell'
import { WeldTableEmptyRow } from '@/components/weld-table-empty-row'
import { WeldTableRowSelectCell } from '@/components/weld-table-row-select-cell'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ReportRowActions } from '@/lib/report-row-actions'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import type { WeldTableDisplaySection } from '@/lib/weld-table-sections'
import { memo, useMemo, type MouseEvent, type RefCallback } from 'react'
import {
  getWeldTableRowClassName,
  getWeldTableRowTitle,
  getWeldTableStickyCellBackgroundClassName,
} from '@/lib/weld-table-row-state'
import { getCellKey, getDuplicateKey } from '@/lib/weld-table-utils'
import { RESULT_FIELD_KEYS, type WeldFieldKey } from '@/lib/weld-fields'
import type { SystemDocumentTemplateId } from '@/lib/system-document-template-types'
import {
  buildWeldTableRenderColumns,
  type WeldTableRenderColumn,
} from '@/lib/weld-table-horizontal-window'

type WeldTableBodyRowsProps = {
  rows: WeldRow[]
  rowIndexes?: number[]
  measureRow?: RefCallback<HTMLTableRowElement>
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
  contextMenuAnchorRowId?: number
  canEditField: (fieldKey: WeldFieldKey) => boolean
  canEditCell: (row: WeldRow, fieldKey: WeldFieldKey) => boolean
  stickyLeft: number
  stickyIdentityLeadingWidth: number
  stickyIdentityColumns: boolean
  getDisplayValue: (row: WeldRow, fieldKey: WeldFieldKey) => unknown
  getActionRow: (row: WeldRow) => WeldRow
  onEdit?: (row: WeldRow, fieldKey?: WeldFieldKey) => void
  onDelete?: (id: number) => void
  onContextMenu?: (event: MouseEvent, row: WeldRow) => void
  onOpenDocument?: (row: WeldRow, fieldKey: WeldFieldKey) => void
  onOpenLnkRequest?: (row: WeldRow, fieldKey: WeldFieldKey) => void
  onOpenLnkResult?: (row: WeldRow, fieldKey: WeldFieldKey) => void
  availableSystemDocumentTypes?: ReadonlySet<SystemDocumentTemplateId>
  visibleFieldKeys?: ReadonlySet<WeldFieldKey>
}

export function WeldTableBodyRows({
  rows,
  rowIndexes,
  measureRow,
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
  contextMenuAnchorRowId,
  canEditField,
  canEditCell,
  stickyLeft,
  stickyIdentityLeadingWidth,
  stickyIdentityColumns,
  getDisplayValue,
  getActionRow,
  onEdit,
  onDelete,
  onContextMenu,
  onOpenDocument,
  onOpenLnkRequest,
  onOpenLnkResult,
  availableSystemDocumentTypes,
  visibleFieldKeys,
}: WeldTableBodyRowsProps) {
  const renderColumns = useMemo(
    () => buildWeldTableRenderColumns({ sections, extraColumns, visibleFieldKeys }),
    [extraColumns, sections, visibleFieldKeys],
  )
  const hasControlColumn = selectable || hasChainAction

  if (rows.length === 0) {
    return <WeldTableEmptyRow colSpan={colSpan} />
  }

  return (
    <>
      {rows.map((row, visibleRowIndex) => {
        const rowIndex = rowIndexes?.[visibleRowIndex] ?? visibleRowIndex
        const actionRow = getActionRow(row)
        const isDuplicate = duplicateKeys.has(getDuplicateKey(row) ?? '')
        const isHighlighted = highlightedRowIds.has(row.id)
        const isSelected = selectedRowIds.has(row.id)
        const hasDispatcherTask = dispatcherTaskRowIds.has(row.id)
        const isContextMenuAnchor = contextMenuAnchorRowId === row.id
        const isSelectableRow = !selectable || isRowSelectable(actionRow)
        return (
          <WeldTableBodyRow
            key={row.id}
            row={row}
            actionRow={actionRow}
            rowIndex={rowIndex}
            measureRow={measureRow}
            renderColumns={renderColumns}
            readOnly={readOnly}
            selectable={selectable}
            hasControlColumn={hasControlColumn}
            hasRowActions={hasRowActions}
            rowActions={rowActions}
            isDuplicate={isDuplicate}
            isHighlighted={isHighlighted}
            isSelected={isSelected}
            hasDispatcherTask={hasDispatcherTask}
            isContextMenuAnchor={isContextMenuAnchor}
            isSelectableRow={isSelectableRow}
            onSetRowSelected={onSetRowSelected}
            highlightedCellKeys={highlightedCellKeys}
            canEditField={canEditField}
            canEditCell={canEditCell}
            stickyLeft={stickyLeft}
            stickyIdentityLeadingWidth={stickyIdentityLeadingWidth}
            stickyIdentityColumns={stickyIdentityColumns}
            getDisplayValue={getDisplayValue}
            onEdit={onEdit}
            onDelete={onDelete}
            onContextMenu={onContextMenu}
            onOpenDocument={onOpenDocument}
            onOpenLnkRequest={onOpenLnkRequest}
            onOpenLnkResult={onOpenLnkResult}
            availableSystemDocumentTypes={availableSystemDocumentTypes}
          />
        )
      })}
    </>
  )
}

type WeldTableBodyRowProps = {
  row: WeldRow
  actionRow: WeldRow
  rowIndex: number
  measureRow?: RefCallback<HTMLTableRowElement>
  renderColumns: WeldTableRenderColumn[]
  readOnly: boolean
  selectable: boolean
  hasControlColumn: boolean
  hasRowActions: boolean
  rowActions?: ReportRowActions
  isDuplicate: boolean
  isHighlighted: boolean
  isSelected: boolean
  hasDispatcherTask: boolean
  isContextMenuAnchor: boolean
  isSelectableRow: boolean
  onSetRowSelected: (row: WeldRow, selected: boolean) => void
  highlightedCellKeys: ReadonlySet<string>
  canEditField: (fieldKey: WeldFieldKey) => boolean
  canEditCell: (row: WeldRow, fieldKey: WeldFieldKey) => boolean
  stickyLeft: number
  stickyIdentityLeadingWidth: number
  stickyIdentityColumns: boolean
  getDisplayValue: (row: WeldRow, fieldKey: WeldFieldKey) => unknown
  onEdit?: (row: WeldRow, fieldKey?: WeldFieldKey) => void
  onDelete?: (id: number) => void
  onContextMenu?: (event: MouseEvent, row: WeldRow) => void
  onOpenDocument?: (row: WeldRow, fieldKey: WeldFieldKey) => void
  onOpenLnkRequest?: (row: WeldRow, fieldKey: WeldFieldKey) => void
  onOpenLnkResult?: (row: WeldRow, fieldKey: WeldFieldKey) => void
  availableSystemDocumentTypes?: ReadonlySet<SystemDocumentTemplateId>
}

const WeldTableBodyRow = memo(function WeldTableBodyRow({
  row,
  actionRow,
  rowIndex,
  measureRow,
  renderColumns,
  readOnly,
  selectable,
  hasControlColumn,
  hasRowActions,
  rowActions,
  isDuplicate,
  isHighlighted,
  isSelected,
  hasDispatcherTask,
  isContextMenuAnchor,
  isSelectableRow,
  onSetRowSelected,
  highlightedCellKeys,
  canEditField,
  canEditCell,
  stickyLeft,
  stickyIdentityLeadingWidth,
  stickyIdentityColumns,
  getDisplayValue,
  onEdit,
  onDelete,
  onContextMenu,
  onOpenDocument,
  onOpenLnkRequest,
  onOpenLnkResult,
  availableSystemDocumentTypes,
}: WeldTableBodyRowProps) {
  const stickyBackgroundClassName = getWeldTableStickyCellBackgroundClassName({
    rowIndex,
    isHighlighted,
    isSelected,
    isDuplicate,
    hasDispatcherTask,
    isContextMenuAnchor,
  })

  return (
    <tr
      ref={measureRow}
      data-index={rowIndex}
      data-weld-row-id={row.id}
      className={getWeldTableRowClassName({ rowIndex, readOnly, isHighlighted, isSelected, isDuplicate, hasDispatcherTask, isContextMenuAnchor })}
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
          onChange={(selected) => onSetRowSelected(actionRow, selected)}
        />
      ) : null}
      {hasRowActions && rowActions ? <WeldTableRowActions row={actionRow} rowActions={rowActions} /> : null}
      {renderColumns.map((renderColumn) => {
        if (renderColumn.kind === 'spacer') {
          return <HorizontalBodySpacer key={renderColumn.key} colSpan={renderColumn.colSpan} />
        }
        if (renderColumn.kind === 'extra') {
          return <ExtraBodyCell key={renderColumn.key} column={renderColumn.column} row={actionRow} />
        }
        const { field, isSectionEnd } = renderColumn
        const fieldKey = field.key as WeldFieldKey
        const isEditableColumn = canEditField(fieldKey)
        const isEditableCell = canEditCell(actionRow, fieldKey)
        const isBlockedEditableCell = isEditableColumn && !isEditableCell
        const isCellHighlighted = highlightedCellKeys.has(getCellKey(row.id, field.key))
        const isResultField = RESULT_FIELD_KEYS.has(fieldKey)
        const displayValue = getDisplayValue(row, fieldKey)
        return (
          <WeldTableBodyCell
            key={renderColumn.key}
            row={actionRow}
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
            onOpenDocument={onOpenDocument}
            onOpenLnkRequest={onOpenLnkRequest}
            onOpenLnkResult={onOpenLnkResult}
            availableSystemDocumentTypes={availableSystemDocumentTypes}
          />
        )
      })}
      {!readOnly ? <WeldTableEditActionsCell row={actionRow} onEdit={onEdit} onDelete={onDelete} /> : null}
    </tr>
  )
})

function HorizontalBodySpacer({ colSpan }: { colSpan: number }) {
  return (
    <td
      aria-hidden="true"
      data-horizontal-spacer="true"
      colSpan={colSpan}
      className="h-[52px] border-b border-r border-b-slate-100 border-r-slate-100 bg-inherit p-0"
    />
  )
}

function ExtraBodyCell({ column, row }: { column: WeldTableExtraColumn; row: WeldRow }) {
  return (
    <td className="border-b border-r border-b-slate-100 border-r-slate-200 bg-slate-50/80 p-0 align-top">
      {column.renderCell(row)}
    </td>
  )
}
