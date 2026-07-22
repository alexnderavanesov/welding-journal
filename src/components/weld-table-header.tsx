import { WeldTableFieldHeaderRows } from '@/components/weld-table-field-header-rows'
import { WeldTableRowActionsHeader, WeldTableSelectAllHeader } from '@/components/weld-table-header-cells'
import { WeldTableSectionHeaderRow } from '@/components/weld-table-section-header-row'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldTableDisplaySection } from '@/lib/weld-table-sections'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import type { WeldFieldKey } from '@/lib/weld-fields'

type WeldTableHeaderProps = {
  selectable: boolean
  allVisibleRowsSelected: boolean
  someVisibleRowsSelected: boolean
  selectableVisibleRowsCount: number
  selectedRowsCount: number
  onSetVisibleRowsSelected: (selected: boolean) => void
  hasChainAction: boolean
  hasColumnFilters: boolean
  onResetColumnFilters: () => void
  hasRowActions: boolean
  rowActionsHeaderLabel: string
  rowActionsScreenReaderLabel: string
  filteredSections: WeldTableDisplaySection[]
  extraColumns: WeldTableExtraColumn[]
  alwaysVisibleFieldKeys: ReadonlySet<WeldFieldKey>
  readOnly: boolean
  rows: WeldRow[]
  stickyLeft: number
  stickyIdentityLeadingWidth: number
  stickyIdentityColumns: boolean
  onToggleSection: (section: string) => void
  columnFilters: Record<string, string>
  canEditField: (fieldKey: WeldFieldKey) => boolean
  onColumnFiltersChange: (filters: Record<string, string>) => void
}

export function WeldTableHeader({
  selectable,
  allVisibleRowsSelected,
  someVisibleRowsSelected,
  selectableVisibleRowsCount,
  selectedRowsCount,
  onSetVisibleRowsSelected,
  hasChainAction,
  hasColumnFilters,
  onResetColumnFilters,
  hasRowActions,
  rowActionsHeaderLabel,
  rowActionsScreenReaderLabel,
  filteredSections,
  extraColumns,
  alwaysVisibleFieldKeys,
  readOnly,
  rows,
  stickyLeft,
  stickyIdentityLeadingWidth,
  stickyIdentityColumns,
  onToggleSection,
  columnFilters,
  canEditField,
  onColumnFiltersChange,
}: WeldTableHeaderProps) {
  const selectStickyLeft = stickyLeft
  const hasControlColumn = selectable || hasChainAction

  return (
    <thead className="sticky top-0 z-10 bg-[#f7fbfe]/95 text-left shadow-[0_2px_10px_rgba(15,23,42,0.07),inset_0_-1px_0_0_#d6e5ef] backdrop-blur">
      <tr>
        {hasControlColumn ? (
          <WeldTableSelectAllHeader
            selectable={selectable}
            checked={allVisibleRowsSelected}
            indeterminate={someVisibleRowsSelected}
            disabled={selectableVisibleRowsCount === 0}
            selectedRowsCount={selectedRowsCount}
            title={
              selectableVisibleRowsCount === 0
                ? 'Нет доступных строк для выбора'
                : allVisibleRowsSelected || someVisibleRowsSelected
                  ? 'Снять выбор с видимых строк'
                  : 'Выбрать видимые строки'
            }
            hasColumnFilters={hasColumnFilters}
            sticky={stickyIdentityColumns}
            stickyLeft={selectStickyLeft}
            onChange={onSetVisibleRowsSelected}
            onResetColumnFilters={onResetColumnFilters}
          />
        ) : null}
        {hasRowActions ? (
          <WeldTableRowActionsHeader label={rowActionsHeaderLabel} screenReaderLabel={rowActionsScreenReaderLabel} />
        ) : null}
        <WeldTableSectionHeaderRow
          sections={filteredSections}
          alwaysVisibleFieldKeys={alwaysVisibleFieldKeys}
          readOnly={readOnly}
          extraColumns={extraColumns}
          onToggleSection={onToggleSection}
        />
      </tr>
      <WeldTableFieldHeaderRows
        sections={filteredSections}
        rows={rows}
        columnFilters={columnFilters}
        extraColumns={extraColumns}
        stickyLeft={stickyLeft}
        stickyIdentityLeadingWidth={stickyIdentityLeadingWidth}
        stickyIdentityColumns={stickyIdentityColumns}
        canEditField={canEditField}
        onColumnFiltersChange={onColumnFiltersChange}
      />
    </thead>
  )
}
