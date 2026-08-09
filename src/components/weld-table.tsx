import { useCallback, useMemo, useState, type MouseEvent } from 'react'

import { ContextActionMenu, type ContextActionMenuItem, type ContextActionMenuState } from '@/components/context-action-menu'
import { PaginationBar } from '@/components/pagination-bar'
import { WeldTableBodyRows } from '@/components/weld-table-body-rows'
import { WeldTableColumns } from '@/components/weld-table-columns'
import { WeldTableHeader } from '@/components/weld-table-header'
import { WeldTableSectionToolbar } from '@/components/weld-table-section-toolbar'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ReportRowActions } from '@/lib/report-row-actions'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import { useWeldTableModel } from '@/lib/use-weld-table-model'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { SELECT_COLUMN_WIDTH } from '@/lib/weld-table-layout'
import type { WeldColumnFilterOption, WeldReportKind } from '@/server/welds'
import type { SystemDocumentTemplateId } from '@/lib/system-document-template-types'
import { useWindowTableVirtualization } from '@/lib/use-window-table-virtualization'

export type WeldTableProps = {
  rows: WeldRow[]
  actionRows?: WeldRow[]
  duplicateRows?: WeldRow[]
  duplicateKeyOverrides?: ReadonlySet<string>
  filterOptionRows?: WeldRow[]
  columnFilters: Record<string, string>
  manualFiltering?: boolean
  manualFilterOptionsReport?: WeldReportKind
  manualFilterOptions?: Record<string, WeldColumnFilterOption[]>
  manualPagination?: {
    totalCount: number
    firstItemNumber: number
    lastItemNumber: number
    pageSize: number
    hasMore: boolean
    onLoadMore: () => void
    onPageSizeChange: (pageSize: number) => void
  }
  onColumnFiltersChange: (filters: Record<string, string>) => void
  onEdit?: (row: WeldRow, fieldKey?: WeldFieldKey) => void
  onDelete?: (id: number) => void
  stickyLeft?: number
  highlightedRowIds?: ReadonlySet<number>
  highlightedCellKeys?: ReadonlySet<string>
  dispatcherTaskRowIds?: ReadonlySet<number>
  readOnly?: boolean
  editableFieldKeys?: ReadonlySet<WeldFieldKey>
  blockedFieldKeys?: ReadonlySet<WeldFieldKey>
  isCellEditable?: (row: WeldRow, fieldKey: WeldFieldKey) => boolean
  getDisplayValue?: (row: WeldRow, fieldKey: WeldFieldKey) => unknown
  onOpenChain?: (row: WeldRow) => void
  onFilterLine?: (row: WeldRow) => void
  onOpenLinkedReport?: (row: WeldRow) => void
  onOpenDocument?: (row: WeldRow, fieldKey: WeldFieldKey) => void
  availableSystemDocumentTypes?: ReadonlySet<SystemDocumentTemplateId>
  openLinkedReportTitle?: string
  selectable?: boolean
  selectedRowIds?: ReadonlySet<number>
  onSelectedRowIdsChange?: (ids: Set<number>) => void
  isRowSelectable?: (row: WeldRow) => boolean
  storageKey?: string
  hiddenFieldKeys?: ReadonlySet<WeldFieldKey>
  mergePstoSections?: boolean
  rowActions?: ReportRowActions
  extraColumns?: WeldTableExtraColumn[]
  stickyIdentityColumns?: boolean
  getContextMenuItems?: (
    row: WeldRow,
    selectedRows: WeldRow[],
    fieldKey?: WeldFieldKey,
  ) => ContextActionMenuItem[]
}

export function WeldTable({
  rows,
  actionRows,
  duplicateRows,
  duplicateKeyOverrides,
  filterOptionRows,
  columnFilters,
  manualFiltering = false,
  manualFilterOptionsReport,
  manualFilterOptions,
  manualPagination,
  onColumnFiltersChange,
  onEdit,
  onDelete,
  stickyLeft = 0,
  highlightedRowIds = new Set(),
  highlightedCellKeys = new Set(),
  dispatcherTaskRowIds = new Set(),
  readOnly = false,
  editableFieldKeys = new Set(),
  blockedFieldKeys = new Set(),
  isCellEditable = () => true,
  getDisplayValue = (row, fieldKey) => row[fieldKey],
  onOpenChain,
  onFilterLine,
  onOpenLinkedReport,
  onOpenDocument,
  availableSystemDocumentTypes = new Set(),
  selectable = false,
  selectedRowIds = new Set(),
  onSelectedRowIdsChange,
  isRowSelectable = () => true,
  storageKey = 'default',
  hiddenFieldKeys = new Set(),
  mergePstoSections = false,
  rowActions,
  extraColumns = [],
  stickyIdentityColumns = false,
  getContextMenuItems,
}: WeldTableProps) {
  const [contextMenu, setContextMenu] = useState<ContextActionMenuState>(null)
  const modelManualPagination = useMemo(
    () =>
      manualPagination
        ? {
            totalCount: manualPagination.totalCount,
            firstItemNumber: manualPagination.firstItemNumber,
            lastItemNumber: manualPagination.lastItemNumber,
            pageSize: manualPagination.pageSize,
            hasMore: manualPagination.hasMore,
            loadMore: manualPagination.onLoadMore,
            setPageSize: manualPagination.onPageSizeChange,
          }
        : undefined,
    [manualPagination],
  )
  const {
    alwaysVisibleFieldKeys,
    availableSections,
    collapsedSections,
    duplicateKeys: tableDuplicateKeys,
    paginatedRows,
    filteredSections,
    hasChainAction,
    hasColumnFilters,
    hasRowActions,
    tableColumnSpan,
    tableMinWidth,
    toggleSection,
    selectableVisibleRows,
    allVisibleRowsSelected,
    someVisibleRowsSelected,
    setRowSelected,
    setVisibleRowsSelected,
    canEditField,
    canEditCell,
    pagination,
  } = useWeldTableModel({
    rows,
    duplicateRows,
    duplicateKeys: duplicateKeyOverrides,
    columnFilters,
    manualFiltering,
    manualPagination: modelManualPagination,
    onEdit,
    readOnly,
    editableFieldKeys,
    blockedFieldKeys,
    isCellEditable,
    onOpenChain,
    onFilterLine,
    onOpenLinkedReport,
    selectable,
    selectedRowIds,
    onSelectedRowIdsChange,
    isRowSelectable,
    storageKey,
    hiddenFieldKeys,
    mergePstoSections,
    rowActions,
  })
  const extraColumnsWidth = extraColumns.reduce((total, column) => total + column.width, 0)
  const fullTableMinWidth = tableMinWidth + extraColumnsWidth
  const fullTableColumnSpan = tableColumnSpan + extraColumns.length
  const hasControlColumn = selectable || hasChainAction
  const stickyIdentityLeadingWidth = stickyIdentityColumns && hasControlColumn ? SELECT_COLUMN_WIDTH : 0
  const stateRows = filterOptionRows ?? duplicateRows ?? actionRows ?? rows
  const actionSourceRows = actionRows ?? stateRows
  const headerFilterRows = filterOptionRows ?? rows
  const rowsById = useMemo(() => new Map(actionSourceRows.map((row) => [row.id, row])), [actionSourceRows])
  const getActionRow = useCallback((row: WeldRow) => {
    const actionRow = rowsById.get(row.id)
    if (!actionRow) return row
    if (!row.jsrDocumentId && !row.checklistDocumentId && !row.zniDocumentId) return actionRow
    return {
      ...actionRow,
      ...(row.jsrDocumentId
        ? { jsrDocument: row.jsrDocument, jsrDocumentId: row.jsrDocumentId }
        : {}),
      ...(row.checklistDocumentId
        ? {
            checklistDocument: row.checklistDocument,
            checklistDocumentId: row.checklistDocumentId,
          }
        : {}),
      ...(row.zniDocumentId
        ? {
            zniDocument: row.zniDocument,
            zniDocumentId: row.zniDocumentId,
          }
        : {}),
    }
  }, [rowsById])
  const selectedRows = useMemo(
    () => Array.from(selectedRowIds).map((rowId) => rowsById.get(rowId)).filter((row): row is WeldRow => Boolean(row)),
    [rowsById, selectedRowIds],
  )
  const {
    bodyRef,
    bottomSpacerHeight,
    measureRow,
    rowIndexes,
    topSpacerHeight,
    visibleRows,
  } = useWindowTableVirtualization({ rows: paginatedRows })
  const openRowContextMenu = useCallback(
    (event: MouseEvent, row: WeldRow) => {
      const actionRow = getActionRow(row)
      const contextRows = selectedRowIds.has(row.id) && selectedRows.length > 1 ? selectedRows : [actionRow]
      const cell = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-weld-field-key]')
      const fieldKey = cell?.dataset.weldFieldKey as WeldFieldKey | undefined
      const items = getContextMenuItems?.(actionRow, contextRows, fieldKey).filter((item, index, list) => {
        if (item.type !== 'separator') return true
        return index > 0 && list[index - 1]?.type !== 'separator' && list[index + 1]?.type !== 'separator'
      })
      if (!items?.length) return
      event.preventDefault()
      setContextMenu({ x: event.clientX, y: event.clientY, anchorRowId: row.id, items })
    },
    [getActionRow, getContextMenuItems, selectedRowIds, selectedRows],
  )

  return (
    <div className="w-max space-y-3" style={{ minWidth: fullTableMinWidth }}>
      <WeldTableSectionToolbar
        sections={availableSections}
        collapsedSections={collapsedSections}
        alwaysVisibleFieldKeys={alwaysVisibleFieldKeys}
        tableMinWidth={fullTableMinWidth}
        stickyLeft={stickyLeft}
        onToggleSection={toggleSection}
      />
      <div className="rounded-lg border border-[#dbe7f0] bg-white shadow-sm shadow-slate-200/45" style={{ minWidth: fullTableMinWidth }}>
        <table
          className="table-fixed border-separate border-spacing-0 text-[13px] text-slate-700 [&_td]:outline-none [&_th]:outline-none"
          style={{ width: fullTableMinWidth }}
        >
          <WeldTableColumns
            sections={filteredSections}
            readOnly={readOnly}
            selectable={selectable}
            hasRowActions={hasRowActions}
            hasChainAction={hasChainAction}
            extraColumns={extraColumns}
          />
          <WeldTableHeader
            selectable={selectable}
            allVisibleRowsSelected={allVisibleRowsSelected}
            someVisibleRowsSelected={someVisibleRowsSelected}
            selectableVisibleRowsCount={selectableVisibleRows.length}
            selectedRowsCount={selectedRows.length}
            onSetVisibleRowsSelected={setVisibleRowsSelected}
            hasChainAction={hasChainAction}
            hasColumnFilters={hasColumnFilters}
            onResetColumnFilters={() => onColumnFiltersChange({})}
            hasRowActions={hasRowActions}
            rowActionsHeaderLabel={rowActions?.headerLabel ?? 'Быстрые действия'}
            rowActionsScreenReaderLabel={rowActions?.headerLabel ?? 'Действия'}
            filteredSections={filteredSections}
            extraColumns={extraColumns}
            alwaysVisibleFieldKeys={alwaysVisibleFieldKeys}
            readOnly={readOnly}
            rows={headerFilterRows}
            stickyLeft={stickyIdentityColumns ? stickyLeft : 0}
            stickyIdentityLeadingWidth={stickyIdentityLeadingWidth}
            stickyIdentityColumns={stickyIdentityColumns}
            onToggleSection={toggleSection}
            columnFilters={columnFilters}
            canEditField={canEditField}
            manualFilterOptionsReport={manualFilterOptionsReport}
            manualFilterOptions={manualFilterOptions}
            onColumnFiltersChange={onColumnFiltersChange}
          />
          <tbody ref={bodyRef}>
            <TableVirtualSpacer colSpan={fullTableColumnSpan} height={topSpacerHeight} />
            <WeldTableBodyRows
              rows={visibleRows}
              rowIndexes={rowIndexes}
              measureRow={measureRow}
              sections={filteredSections}
              colSpan={fullTableColumnSpan}
              readOnly={readOnly}
              selectable={selectable}
              selectedRowIds={selectedRowIds}
              onSetRowSelected={setRowSelected}
              isRowSelectable={isRowSelectable}
              hasChainAction={hasChainAction}
              hasRowActions={hasRowActions}
              rowActions={rowActions}
              extraColumns={extraColumns}
              duplicateKeys={tableDuplicateKeys}
              highlightedRowIds={highlightedRowIds}
              highlightedCellKeys={highlightedCellKeys}
              dispatcherTaskRowIds={dispatcherTaskRowIds}
              contextMenuAnchorRowId={contextMenu?.anchorRowId}
              canEditField={canEditField}
              canEditCell={canEditCell}
              stickyLeft={stickyIdentityColumns ? stickyLeft : 0}
              stickyIdentityLeadingWidth={stickyIdentityLeadingWidth}
              stickyIdentityColumns={stickyIdentityColumns}
              getDisplayValue={getDisplayValue}
              getActionRow={getActionRow}
              onEdit={onEdit}
              onDelete={onDelete}
              onContextMenu={getContextMenuItems ? openRowContextMenu : undefined}
              onOpenDocument={onOpenDocument}
              availableSystemDocumentTypes={availableSystemDocumentTypes}
            />
            <TableVirtualSpacer colSpan={fullTableColumnSpan} height={bottomSpacerHeight} />
          </tbody>
        </table>
      </div>
      <div
        className="sticky w-[min(100vw-2rem,720px)]"
        style={{
          left: stickyLeft,
          maxWidth: `calc(100vw - ${stickyLeft + 24}px)`,
        }}
      >
        <PaginationBar
          totalCount={pagination.totalCount}
          firstItemNumber={pagination.firstItemNumber}
          lastItemNumber={pagination.lastItemNumber}
          pageSize={pagination.pageSize}
          hasMore={pagination.hasMore}
          onLoadMore={pagination.loadMore}
          onPageSizeChange={pagination.setPageSize}
        />
      </div>
      <ContextActionMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  )
}

function TableVirtualSpacer({ colSpan, height }: { colSpan: number; height: number }) {
  if (height <= 0) return null
  return (
    <tr aria-hidden="true">
      <td colSpan={colSpan} style={{ height, padding: 0, border: 0 }} />
    </tr>
  )
}
