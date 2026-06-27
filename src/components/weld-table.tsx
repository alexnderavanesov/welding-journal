import { useMemo } from 'react'
import { WeldTableFilterResetHeader } from '@/components/weld-table-actions'
import { WeldTableBodyRows } from '@/components/weld-table-body-rows'
import { WeldTableColumns } from '@/components/weld-table-columns'
import { WeldTableFieldHeaderRows } from '@/components/weld-table-field-header-rows'
import { WeldTableRowActionsHeader, WeldTableSelectAllHeader } from '@/components/weld-table-header-cells'
import { WeldTableSectionHeaderRow } from '@/components/weld-table-section-header-row'
import { WeldTableSectionToolbar } from '@/components/weld-table-section-toolbar'
import { filterWeldRowsByColumns, hasColumnFilters as getHasColumnFilters } from '@/lib/weld-table-filtering'
import { getWeldTableColumnSpan, getWeldTableMinWidth } from '@/lib/weld-table-layout'
import {
  getAlwaysVisibleFieldKeys,
  getAvailableWeldTableSections,
  getFilteredWeldTableSections,
} from '@/lib/weld-table-sections'
import type { ReportRowActions } from '@/lib/report-row-actions'
import { useWeldTableCollapsedSections } from '@/lib/use-weld-table-collapsed-sections'
import { useWeldTableEditability } from '@/lib/use-weld-table-editability'
import { useWeldTableSelection } from '@/lib/use-weld-table-selection'
import { getDuplicateKeys } from '@/lib/weld-table-utils'
import { type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'

export type WeldTableProps = {
  rows: Array<WeldInput & { id: number }>
  columnFilters: Record<string, string>
  onColumnFiltersChange: (filters: Record<string, string>) => void
  onEdit?: (row: WeldInput & { id: number }, fieldKey?: WeldFieldKey) => void
  onDelete?: (id: number) => void
  stickyLeft?: number
  highlightedRowIds?: ReadonlySet<number>
  highlightedCellKeys?: ReadonlySet<string>
  readOnly?: boolean
  editableFieldKeys?: ReadonlySet<WeldFieldKey>
  blockedFieldKeys?: ReadonlySet<WeldFieldKey>
  isCellEditable?: (row: WeldInput & { id: number }, fieldKey: WeldFieldKey) => boolean
  getDisplayValue?: (row: WeldInput & { id: number }, fieldKey: WeldFieldKey) => unknown
  onOpenChain?: (row: WeldInput & { id: number }) => void
  onOpenLinkedReport?: (row: WeldInput & { id: number }) => void
  openLinkedReportTitle?: string
  selectable?: boolean
  selectedRowIds?: ReadonlySet<number>
  onSelectedRowIdsChange?: (ids: Set<number>) => void
  isRowSelectable?: (row: WeldInput & { id: number }) => boolean
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
  const alwaysVisibleFieldKeys = useMemo(() => getAlwaysVisibleFieldKeys(mergePstoSections), [mergePstoSections])
  const availableSections = useMemo(
    () => getAvailableWeldTableSections({ hiddenFieldKeys, mergePstoSections }),
    [hiddenFieldKeys, mergePstoSections],
  )
  const { collapsedSections, toggleSection } = useWeldTableCollapsedSections({
    storageKey,
    availableSections,
    alwaysVisibleFieldKeys,
  })
  const filteredSections = useMemo(
    () => getFilteredWeldTableSections({ availableSections, collapsedSections, alwaysVisibleFieldKeys }),
    [alwaysVisibleFieldKeys, availableSections, collapsedSections],
  )
  const filteredFields = useMemo(() => filteredSections.flatMap((group) => group.fields), [filteredSections])
  const hasRowActions = Boolean(rowActions)
  const hasChainAction = Boolean(onOpenChain || onOpenLinkedReport)
  const hasColumnFilters = getHasColumnFilters(columnFilters)
  const tableColumnSpan = getWeldTableColumnSpan({
    fieldCount: filteredFields.length,
    readOnly,
    selectable,
    hasRowActions,
    hasChainAction,
  })
  const tableMinWidth = getWeldTableMinWidth({
    fields: filteredFields,
    readOnly,
    selectable,
    hasRowActions,
    hasChainAction,
  })
  const duplicateKeys = useMemo(() => getDuplicateKeys(rows), [rows])
  const filteredRows = useMemo(() => filterWeldRowsByColumns(rows, columnFilters), [rows, columnFilters])
  const {
    selectableVisibleRows,
    allVisibleRowsSelected,
    someVisibleRowsSelected,
    setRowSelected,
    setVisibleRowsSelected,
  } = useWeldTableSelection({
    filteredRows,
    selectable,
    selectedRowIds,
    onSelectedRowIdsChange,
    isRowSelectable,
  })
  const { canEditField, canEditCell } = useWeldTableEditability({
    onEdit,
    readOnly,
    editableFieldKeys,
    blockedFieldKeys,
    isCellEditable,
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
          <thead className="sticky top-0 z-10 bg-slate-50/95 text-left shadow-[inset_0_-1px_0_0_rgb(226,232,240)] backdrop-blur">
            <tr>
              {selectable ? (
                <WeldTableSelectAllHeader
                  checked={allVisibleRowsSelected}
                  indeterminate={someVisibleRowsSelected}
                  disabled={selectableVisibleRows.length === 0}
                  title={selectableVisibleRows.length === 0 ? 'Нет доступных стыков для новой заявки' : 'Выбрать видимые стыки'}
                  onChange={setVisibleRowsSelected}
                />
              ) : null}
              {hasChainAction ? (
                <WeldTableFilterResetHeader hasColumnFilters={hasColumnFilters} onReset={() => onColumnFiltersChange({})} />
              ) : null}
              {hasRowActions ? (
                <WeldTableRowActionsHeader
                  label={rowActions?.headerLabel ?? 'Быстрые действия'}
                  screenReaderLabel={rowActions?.headerLabel ?? 'Действия'}
                />
              ) : null}
              <WeldTableSectionHeaderRow
                sections={filteredSections}
                alwaysVisibleFieldKeys={alwaysVisibleFieldKeys}
                readOnly={readOnly}
                onToggleSection={toggleSection}
              />
            </tr>
            <WeldTableFieldHeaderRows
              fields={filteredFields}
              columnFilters={columnFilters}
              readOnly={readOnly}
              canEditField={canEditField}
              onColumnFiltersChange={onColumnFiltersChange}
            />
          </thead>
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
