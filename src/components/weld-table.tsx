import { useCallback, useMemo, useRef, useState, type MouseEvent } from 'react'
import { CheckSquare2, MoreHorizontal, X } from 'lucide-react'

import { ContextActionMenu, type ContextActionMenuItem, type ContextActionMenuState } from '@/components/context-action-menu'
import { PaginationBar } from '@/components/pagination-bar'
import { WeldTableBodyRows } from '@/components/weld-table-body-rows'
import { getWeldTableBodyCellTooltip } from '@/components/weld-table-body-cell'
import { WeldTableColumns } from '@/components/weld-table-columns'
import { WeldTableHeader } from '@/components/weld-table-header'
import { WeldTableSectionToolbar } from '@/components/weld-table-section-toolbar'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ReportRowActions } from '@/lib/report-row-actions'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import { useWeldTableModel } from '@/lib/use-weld-table-model'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { ROW_ACTIONS_COLUMN_WIDTH, SELECT_COLUMN_WIDTH } from '@/lib/weld-table-layout'
import type { WeldColumnFilterOption, WeldReportKind } from '@/server/welds'
import type { SystemDocumentTemplateId } from '@/lib/system-document-template-types'
import { useWindowTableVirtualization } from '@/lib/use-window-table-virtualization'
import { useWindowTableHorizontalVirtualization } from '@/lib/use-window-table-horizontal-virtualization'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'

const EMPTY_FIELD_KEY_SET = new Set<WeldFieldKey>()
const EMPTY_NUMBER_SET = new Set<number>()
const EMPTY_STRING_SET = new Set<string>()
const EMPTY_SYSTEM_DOCUMENT_TYPE_SET = new Set<SystemDocumentTemplateId>()
const EMPTY_EXTRA_COLUMNS: WeldTableExtraColumn[] = []
const DEFAULT_CELL_EDITABLE = () => true
const DEFAULT_DISPLAY_VALUE = (row: WeldRow, fieldKey: WeldFieldKey) => row[fieldKey]
const DEFAULT_ROW_SELECTABLE = () => true

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
  onOpenLnkRequest?: (row: WeldRow, fieldKey: WeldFieldKey) => void
  onOpenLnkResult?: (row: WeldRow, fieldKey: WeldFieldKey) => void
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
  highlightedRowIds = EMPTY_NUMBER_SET,
  highlightedCellKeys = EMPTY_STRING_SET,
  dispatcherTaskRowIds = EMPTY_NUMBER_SET,
  readOnly = false,
  editableFieldKeys = EMPTY_FIELD_KEY_SET,
  blockedFieldKeys = EMPTY_FIELD_KEY_SET,
  isCellEditable = DEFAULT_CELL_EDITABLE,
  getDisplayValue = DEFAULT_DISPLAY_VALUE,
  onOpenChain,
  onFilterLine,
  onOpenLinkedReport,
  onOpenDocument,
  onOpenLnkRequest,
  onOpenLnkResult,
  availableSystemDocumentTypes = EMPTY_SYSTEM_DOCUMENT_TYPE_SET,
  selectable = false,
  selectedRowIds = EMPTY_NUMBER_SET,
  onSelectedRowIdsChange,
  isRowSelectable = DEFAULT_ROW_SELECTABLE,
  storageKey = 'default',
  hiddenFieldKeys = EMPTY_FIELD_KEY_SET,
  mergePstoSections = false,
  rowActions,
  extraColumns = EMPTY_EXTRA_COLUMNS,
  stickyIdentityColumns = false,
  getContextMenuItems,
}: WeldTableProps) {
  const [contextMenu, setContextMenu] = useState<ContextActionMenuState>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const stableOnColumnFiltersChange = useStableEventCallback(onColumnFiltersChange)
  const stableOnEdit = useStableEventCallback(onEdit)
  const stableOnDelete = useStableEventCallback(onDelete)
  const stableIsCellEditable = useStableEventCallback(isCellEditable)
  const stableGetDisplayValue = useStableEventCallback(getDisplayValue)
  const stableOnOpenChain = useStableEventCallback(onOpenChain)
  const stableOnFilterLine = useStableEventCallback(onFilterLine)
  const stableOnOpenLinkedReport = useStableEventCallback(onOpenLinkedReport)
  const stableOnOpenDocument = useStableEventCallback(onOpenDocument)
  const stableOnOpenLnkRequest = useStableEventCallback(onOpenLnkRequest)
  const stableOnOpenLnkResult = useStableEventCallback(onOpenLnkResult)
  const stableOnSelectedRowIdsChange = useStableEventCallback(onSelectedRowIdsChange)
  const stableIsRowSelectable = useStableEventCallback(isRowSelectable)
  const stableGetContextMenuItems = useStableEventCallback(getContextMenuItems)
  const stableCreateRequest = useStableEventCallback(rowActions?.onCreateRequest)
  const stableAddResult = useStableEventCallback(rowActions?.onAddResult)
  const stableCanCreateRequest = useStableEventCallback(rowActions?.canCreateRequest)
  const stableCanAddResult = useStableEventCallback(rowActions?.canAddResult)
  const stableCellEditable = useCallback(
    (row: WeldRow, fieldKey: WeldFieldKey) => stableIsCellEditable(row, fieldKey) ?? true,
    [stableIsCellEditable],
  )
  const stableRowSelectable = useCallback(
    (row: WeldRow) => stableIsRowSelectable(row) ?? true,
    [stableIsRowSelectable],
  )
  const stableRowActions = useMemo<ReportRowActions | undefined>(
    () =>
      rowActions
        ? {
            ...rowActions,
            onCreateRequest: (row) => stableCreateRequest(row),
            onAddResult: (row) => stableAddResult(row),
            canCreateRequest: (row) => stableCanCreateRequest(row) ?? false,
            canAddResult: (row) => stableCanAddResult(row) ?? false,
          }
        : undefined,
    [
      Boolean(rowActions),
      rowActions?.createAriaLabel,
      rowActions?.createDisabledTitle,
      rowActions?.createTitle,
      rowActions?.headerLabel,
      rowActions?.resultAriaLabel,
      rowActions?.resultDisabledTitle,
      rowActions?.resultTitle,
      stableAddResult,
      stableCanAddResult,
      stableCanCreateRequest,
      stableCreateRequest,
    ],
  )
  const availableSystemDocumentTypesSignature = Array.from(availableSystemDocumentTypes).sort().join('|')
  const stableAvailableSystemDocumentTypes = useMemo(
    () => new Set(availableSystemDocumentTypes),
    // The signature keeps the set stable when only its reference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availableSystemDocumentTypesSignature],
  )
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
    onEdit: onEdit ? stableOnEdit : undefined,
    readOnly,
    editableFieldKeys,
    blockedFieldKeys,
    isCellEditable: stableCellEditable,
    onOpenChain: onOpenChain ? stableOnOpenChain : undefined,
    onFilterLine: onFilterLine ? stableOnFilterLine : undefined,
    onOpenLinkedReport: onOpenLinkedReport ? stableOnOpenLinkedReport : undefined,
    selectable,
    selectedRowIds,
    onSelectedRowIdsChange: onSelectedRowIdsChange ? stableOnSelectedRowIdsChange : undefined,
    isRowSelectable: stableRowSelectable,
    storageKey,
    hiddenFieldKeys,
    mergePstoSections,
    rowActions: stableRowActions,
  })
  const extraColumnsWidth = extraColumns.reduce((total, column) => total + column.width, 0)
  const fullTableMinWidth = tableMinWidth + extraColumnsWidth
  const fullTableColumnSpan = tableColumnSpan + extraColumns.length
  const hasControlColumn = selectable || hasChainAction
  const stickyIdentityLeadingWidth = stickyIdentityColumns && hasControlColumn ? SELECT_COLUMN_WIDTH : 0
  const horizontalLeadingWidth =
    (hasControlColumn ? SELECT_COLUMN_WIDTH : 0) +
    (hasRowActions ? ROW_ACTIONS_COLUMN_WIDTH : 0)
  const {
    enabled: horizontalVirtualizationEnabled,
    visibleFieldKeys,
  } = useWindowTableHorizontalVirtualization({
    tableRef,
    sections: filteredSections,
    extraColumns,
    leadingWidth: horizontalLeadingWidth,
  })
  const stateRows = filterOptionRows ?? duplicateRows ?? actionRows ?? rows
  const actionSourceRows = actionRows ?? stateRows
  const headerFilterRows = filterOptionRows ?? rows
  const rowsById = useMemo(() => new Map(actionSourceRows.map((row) => [row.id, row])), [actionSourceRows])
  const tableRowsById = useMemo(() => new Map(paginatedRows.map((row) => [row.id, row])), [paginatedRows])
  const mergedActionRowsById = useMemo(() => {
    const mergedRows = new Map<number, WeldRow>()
    for (const row of paginatedRows) {
      mergedRows.set(row.id, mergeWeldTableActionRow(rowsById.get(row.id), row))
    }
    return mergedRows
  }, [paginatedRows, rowsById])
  const getActionRow = useCallback((row: WeldRow) => {
    return mergedActionRowsById.get(row.id) ?? mergeWeldTableActionRow(rowsById.get(row.id), row)
  }, [mergedActionRowsById, rowsById])
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
  } = useWindowTableVirtualization({
    rows: paginatedRows,
  })
  const openRowContextMenu = useCallback(
    (event: MouseEvent, row: WeldRow) => {
      const actionRow = getActionRow(row)
      const contextRows = selectedRowIds.has(row.id) && selectedRows.length > 1 ? selectedRows : [actionRow]
      const cell = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-weld-field-key]')
      const fieldKey = cell?.dataset.weldFieldKey as WeldFieldKey | undefined
      const items = stableGetContextMenuItems(actionRow, contextRows, fieldKey)?.filter((item, index, list) => {
        if (item.type !== 'separator') return true
        return index > 0 && list[index - 1]?.type !== 'separator' && list[index + 1]?.type !== 'separator'
      })
      if (!items?.length) return
      event.preventDefault()
      const identity = getWeldContextMenuIdentity(actionRow, contextRows)
      setContextMenu({ x: event.clientX, y: event.clientY, anchorRowId: row.id, ...identity, items })
    },
    [getActionRow, selectedRowIds, selectedRows, stableGetContextMenuItems],
  )
  const openSelectedRowsContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const firstRow = selectedRows[0]
    if (!firstRow) return
    const items = stableGetContextMenuItems(firstRow, selectedRows)?.filter((item, index, list) => {
      if (item.type !== 'separator') return true
      return index > 0 && list[index - 1]?.type !== 'separator' && list[index + 1]?.type !== 'separator'
    })
    if (!items?.length) return
    const rect = event.currentTarget.getBoundingClientRect()
    setContextMenu({
      x: rect.left,
      y: rect.bottom + 4,
      anchorRowId: firstRow.id,
      ...getWeldContextMenuIdentity(firstRow, selectedRows),
      items,
    })
  }, [selectedRows, stableGetContextMenuItems])
  const clearSelectedRows = useCallback(() => {
    stableOnSelectedRowIdsChange(new Set())
  }, [stableOnSelectedRowIdsChange])
  const handleTableMouseOver = useCallback((event: MouseEvent<HTMLTableElement>) => {
    const cell = (event.target as HTMLElement | null)?.closest<HTMLTableCellElement>('td[data-weld-field-key]')
    if (!cell || cell.title) return
    const rowId = Number(cell.closest<HTMLTableRowElement>('tr[data-weld-row-id]')?.dataset.weldRowId)
    const fieldKey = cell.dataset.weldFieldKey as WeldFieldKey | undefined
    const sourceRow = tableRowsById.get(rowId)
    if (!sourceRow || !fieldKey) return
    const row = getActionRow(sourceRow)
    const isEditableColumn = canEditField(fieldKey)
    const isEditableCell = canEditCell(row, fieldKey)
    const tooltip = getWeldTableBodyCellTooltip({
      row,
      fieldKey,
      displayValue: stableGetDisplayValue(row, fieldKey),
      isEditableCell,
      isBlockedEditableCell: isEditableColumn && !isEditableCell,
      canOpenDocument: Boolean(onOpenDocument),
      canOpenLnkRequest: Boolean(onOpenLnkRequest),
      canOpenLnkResult: Boolean(onOpenLnkResult),
      canOpenWeldEditor: Boolean(onEdit),
      availableSystemDocumentTypes: stableAvailableSystemDocumentTypes,
    })
    if (tooltip) cell.title = tooltip
  }, [
    canEditCell,
    canEditField,
    getActionRow,
    onOpenDocument,
    onOpenLnkRequest,
    onOpenLnkResult,
    onEdit,
    stableAvailableSystemDocumentTypes,
    stableGetDisplayValue,
    tableRowsById,
  ])
  const handleTableMouseOut = useCallback((event: MouseEvent<HTMLTableElement>) => {
    const cell = (event.target as HTMLElement | null)?.closest<HTMLTableCellElement>('td[data-weld-field-key]')
    if (!cell) return
    const relatedTarget = event.relatedTarget as Node | null
    if (relatedTarget && cell.contains(relatedTarget)) return
    cell.removeAttribute('title')
  }, [])

  return (
    <div className="space-y-3" style={{ width: fullTableMinWidth }}>
      {selectable && selectedRows.length > 0 ? (
        <div
          className="fixed bottom-2 z-[35] flex h-11 items-center justify-between gap-3 rounded-md border border-slate-200 bg-white/95 px-3 shadow-lg shadow-slate-900/10 backdrop-blur"
          style={{
            left: stickyLeft + 4,
            width: `min(720px, calc(100vw - ${stickyLeft + 20}px))`,
          }}
          aria-label="Действия с выбранными стыками"
        >
          <div className="flex min-w-0 items-center gap-2">
            <CheckSquare2 className="h-4 w-4 shrink-0 text-sky-700" />
            <span className="shrink-0 text-sm font-semibold text-slate-900">Выбрано: {selectedRows.length}</span>
            <span className="hidden truncate text-xs text-slate-500 md:block">Групповые действия применяются ко всем выбранным строкам.</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {getContextMenuItems ? (
              <button
                type="button"
                onClick={openSelectedRowsContextMenu}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-sky-200 bg-white px-2.5 text-xs font-semibold text-sky-800 hover:bg-sky-100"
              >
                <MoreHorizontal className="h-4 w-4" />
                Действия
              </button>
            ) : null}
            <button
              type="button"
              onClick={clearSelectedRows}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
              Снять выбор
            </button>
          </div>
        </div>
      ) : null}
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
          ref={tableRef}
          data-horizontal-virtualized={horizontalVirtualizationEnabled ? 'true' : 'false'}
          onMouseOver={handleTableMouseOver}
          onMouseOut={handleTableMouseOut}
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
            onResetColumnFilters={() => stableOnColumnFiltersChange({})}
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
            onColumnFiltersChange={stableOnColumnFiltersChange}
            visibleFieldKeys={visibleFieldKeys}
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
              isRowSelectable={stableRowSelectable}
              hasChainAction={hasChainAction}
              hasRowActions={hasRowActions}
              rowActions={stableRowActions}
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
              getDisplayValue={stableGetDisplayValue}
              getActionRow={getActionRow}
              onEdit={onEdit ? stableOnEdit : undefined}
              onDelete={onDelete ? stableOnDelete : undefined}
              onContextMenu={getContextMenuItems ? openRowContextMenu : undefined}
              onOpenDocument={onOpenDocument ? stableOnOpenDocument : undefined}
              onOpenLnkRequest={onOpenLnkRequest ? stableOnOpenLnkRequest : undefined}
              onOpenLnkResult={onOpenLnkResult ? stableOnOpenLnkResult : undefined}
              availableSystemDocumentTypes={stableAvailableSystemDocumentTypes}
              visibleFieldKeys={visibleFieldKeys}
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
      {selectable && selectedRows.length > 0 ? (
        <div className="h-12" data-selection-panel-clearance aria-hidden="true" />
      ) : null}
      <ContextActionMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  )
}

function getWeldContextMenuIdentity(row: WeldRow, contextRows: WeldRow[]) {
  if (contextRows.length > 1) {
    const lines = new Set(contextRows.map((item) => String(item.line ?? '').trim()).filter(Boolean))
    return {
      heading: `Выбрано стыков: ${contextRows.length}`,
      description: lines.size === 1 ? `Линия ${Array.from(lines)[0]}` : 'Групповые действия',
    }
  }

  const joint = String(row.joint ?? '').trim()
  const line = String(row.line ?? '').trim()
  return {
    heading: joint ? `Стык ${joint}` : 'Действия по строке',
    description: line ? `Линия ${line}` : undefined,
  }
}

function mergeWeldTableActionRow(actionRow: WeldRow | undefined, displayRow: WeldRow) {
  if (!actionRow) return displayRow
  if (!displayRow.jsrDocumentId && !displayRow.checklistDocumentId && !displayRow.zniDocumentId) return actionRow
  return {
    ...actionRow,
    ...(displayRow.jsrDocumentId
      ? { jsrDocument: displayRow.jsrDocument, jsrDocumentId: displayRow.jsrDocumentId }
      : {}),
    ...(displayRow.checklistDocumentId
      ? {
          checklistDocument: displayRow.checklistDocument,
          checklistDocumentId: displayRow.checklistDocumentId,
        }
      : {}),
    ...(displayRow.zniDocumentId
      ? {
          zniDocument: displayRow.zniDocument,
          zniDocumentId: displayRow.zniDocumentId,
        }
      : {}),
  }
}

function TableVirtualSpacer({ colSpan, height }: { colSpan: number; height: number }) {
  if (height <= 0) return null
  return (
    <tr aria-hidden="true">
      <td colSpan={colSpan} style={{ height, padding: 0, border: 0 }} />
    </tr>
  )
}
