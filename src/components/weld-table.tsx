import { WeldTableBodyRows } from '@/components/weld-table-body-rows'
import { WeldTableColumns } from '@/components/weld-table-columns'
import { WeldTableHeader } from '@/components/weld-table-header'
import { WeldTableSectionToolbar } from '@/components/weld-table-section-toolbar'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ReportRowActions } from '@/lib/report-row-actions'
import { useWeldTableModel } from '@/lib/use-weld-table-model'
import type { WeldFieldKey } from '@/lib/weld-fields'

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
}: WeldTableProps) {
  const {
    alwaysVisibleFieldKeys,
    availableSections,
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

  return (
    <div className="w-max space-y-3" style={{ minWidth: tableMinWidth }}>
      <WeldTableSectionToolbar
        sections={availableSections}
        collapsedSections={collapsedSections}
        alwaysVisibleFieldKeys={alwaysVisibleFieldKeys}
        tableMinWidth={tableMinWidth}
        stickyLeft={stickyLeft}
        onToggleSection={toggleSection}
      />
      <div className="rounded-md border border-slate-100 bg-card shadow-sm shadow-slate-200/30" style={{ minWidth: tableMinWidth }}>
        <table
          className="table-fixed border-separate border-spacing-0 text-sm text-slate-700 [&_td]:outline-none [&_th]:outline-none"
          style={{ width: tableMinWidth }}
        >
          <WeldTableColumns
            fields={filteredFields}
            readOnly={readOnly}
            selectable={selectable}
            hasRowActions={hasRowActions}
            hasChainAction={hasChainAction}
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
            alwaysVisibleFieldKeys={alwaysVisibleFieldKeys}
            readOnly={readOnly}
            onToggleSection={toggleSection}
            filteredFields={filteredFields}
            columnFilters={columnFilters}
            canEditField={canEditField}
            onColumnFiltersChange={onColumnFiltersChange}
          />
          <tbody>
            <WeldTableBodyRows
              rows={filteredRows}
              fields={filteredFields}
              colSpan={tableColumnSpan}
              readOnly={readOnly}
              selectable={selectable}
              selectedRowIds={selectedRowIds}
              onSetRowSelected={setRowSelected}
              isRowSelectable={isRowSelectable}
              hasChainAction={hasChainAction}
              onOpenChain={onOpenChain}
              onOpenLinkedReport={onOpenLinkedReport}
              openLinkedReportTitle={openLinkedReportTitle}
              hasRowActions={hasRowActions}
              rowActions={rowActions}
              duplicateKeys={duplicateKeys}
              highlightedRowIds={highlightedRowIds}
              highlightedCellKeys={highlightedCellKeys}
              canEditField={canEditField}
              canEditCell={canEditCell}
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
