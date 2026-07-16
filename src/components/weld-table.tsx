import { WeldTableBodyRows } from '@/components/weld-table-body-rows'
import { WeldTableColumns } from '@/components/weld-table-columns'
import { WeldTableHeader } from '@/components/weld-table-header'
import { WeldTableSectionToolbar } from '@/components/weld-table-section-toolbar'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ReportRowActions } from '@/lib/report-row-actions'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import { useWeldTableModel } from '@/lib/use-weld-table-model'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { CHAIN_ACTION_COLUMN_WIDTH } from '@/lib/weld-table-layout'

export type WeldTableProps = {
  rows: WeldRow[]
  columnFilters: Record<string, string>
  onColumnFiltersChange: (filters: Record<string, string>) => void
  onEdit?: (row: WeldRow, fieldKey?: WeldFieldKey) => void
  onDelete?: (id: number) => void
  stickyLeft?: number
  highlightedRowIds?: ReadonlySet<number>
  highlightedCellKeys?: ReadonlySet<string>
  readOnly?: boolean
  editableFieldKeys?: ReadonlySet<WeldFieldKey>
  blockedFieldKeys?: ReadonlySet<WeldFieldKey>
  isCellEditable?: (row: WeldRow, fieldKey: WeldFieldKey) => boolean
  getDisplayValue?: (row: WeldRow, fieldKey: WeldFieldKey) => unknown
  onOpenChain?: (row: WeldRow) => void
  onFilterLine?: (row: WeldRow) => void
  onOpenLinkedReport?: (row: WeldRow) => void
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
}

export function WeldTable({
  rows,
  columnFilters,
  onColumnFiltersChange,
  onEdit,
  onDelete,
  stickyLeft = 0,
  highlightedRowIds = new Set(),
  highlightedCellKeys = new Set(),
  readOnly = false,
  editableFieldKeys = new Set(),
  blockedFieldKeys = new Set(),
  isCellEditable = () => true,
  getDisplayValue = (row, fieldKey) => row[fieldKey],
  onOpenChain,
  onFilterLine,
  onOpenLinkedReport,
  openLinkedReportTitle = 'Открыть стык в связанном отчете',
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
}: WeldTableProps) {
  const {
    alwaysVisibleFieldKeys,
    availableSections,
    collapsedSections,
    duplicateKeys,
    filteredFields,
    filteredRows,
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
  } = useWeldTableModel({
    rows,
    columnFilters,
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
  const stickyIdentityLeadingWidth = stickyIdentityColumns && hasChainAction ? CHAIN_ACTION_COLUMN_WIDTH : 0

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
            rows={rows}
            stickyLeft={stickyIdentityColumns ? stickyLeft : 0}
            stickyIdentityLeadingWidth={stickyIdentityLeadingWidth}
            stickyIdentityColumns={stickyIdentityColumns}
            onToggleSection={toggleSection}
            columnFilters={columnFilters}
            canEditField={canEditField}
            onColumnFiltersChange={onColumnFiltersChange}
          />
          <tbody>
            <WeldTableBodyRows
              rows={filteredRows}
              sections={filteredSections}
              colSpan={fullTableColumnSpan}
              readOnly={readOnly}
              selectable={selectable}
              selectedRowIds={selectedRowIds}
              onSetRowSelected={setRowSelected}
              isRowSelectable={isRowSelectable}
              hasChainAction={hasChainAction}
              onOpenChain={onOpenChain}
              onFilterLine={onFilterLine}
              onOpenLinkedReport={onOpenLinkedReport}
              openLinkedReportTitle={openLinkedReportTitle}
              hasRowActions={hasRowActions}
              rowActions={rowActions}
              extraColumns={extraColumns}
              duplicateKeys={duplicateKeys}
              highlightedRowIds={highlightedRowIds}
              highlightedCellKeys={highlightedCellKeys}
              canEditField={canEditField}
              canEditCell={canEditCell}
              stickyLeft={stickyIdentityColumns ? stickyLeft : 0}
              stickyIdentityLeadingWidth={stickyIdentityLeadingWidth}
              stickyIdentityColumns={stickyIdentityColumns}
              getDisplayValue={getDisplayValue}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </tbody>
        </table>
      </div>
    </div>
  )
}
