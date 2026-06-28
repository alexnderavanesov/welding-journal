import { WeldTableFilterResetHeader } from '@/components/weld-table-actions'
import { WeldTableFieldHeaderRows } from '@/components/weld-table-field-header-rows'
import { WeldTableRowActionsHeader, WeldTableSelectAllHeader } from '@/components/weld-table-header-cells'
import { WeldTableSectionHeaderRow } from '@/components/weld-table-section-header-row'
import type { WeldTableDisplaySection } from '@/lib/weld-table-sections'
import type { WeldField, WeldFieldKey } from '@/lib/weld-fields'

type WeldTableHeaderProps = {
  selectable: boolean
  allVisibleRowsSelected: boolean
  someVisibleRowsSelected: boolean
  selectableVisibleRowsCount: number
  onSetVisibleRowsSelected: (selected: boolean) => void
  hasChainAction: boolean
  hasColumnFilters: boolean
  onResetColumnFilters: () => void
  hasRowActions: boolean
  rowActionsHeaderLabel: string
  rowActionsScreenReaderLabel: string
  filteredSections: WeldTableDisplaySection[]
  alwaysVisibleFieldKeys: ReadonlySet<WeldFieldKey>
  readOnly: boolean
  onToggleSection: (section: string) => void
  filteredFields: WeldField[]
  columnFilters: Record<string, string>
  canEditField: (fieldKey: WeldFieldKey) => boolean
  onColumnFiltersChange: (filters: Record<string, string>) => void
}

export function WeldTableHeader({
  selectable,
  allVisibleRowsSelected,
  someVisibleRowsSelected,
  selectableVisibleRowsCount,
  onSetVisibleRowsSelected,
  hasChainAction,
  hasColumnFilters,
  onResetColumnFilters,
  hasRowActions,
  rowActionsHeaderLabel,
  rowActionsScreenReaderLabel,
  filteredSections,
  alwaysVisibleFieldKeys,
  readOnly,
  onToggleSection,
  filteredFields,
  columnFilters,
  canEditField,
  onColumnFiltersChange,
}: WeldTableHeaderProps) {
  return (
    <thead className="sticky top-0 z-10 bg-slate-50/95 text-left shadow-[inset_0_-1px_0_0_rgb(226,232,240)] backdrop-blur">
      <tr>
        {selectable ? (
          <WeldTableSelectAllHeader
            checked={allVisibleRowsSelected}
            indeterminate={someVisibleRowsSelected}
            disabled={selectableVisibleRowsCount === 0}
            title={selectableVisibleRowsCount === 0 ? 'Нет доступных стыков для новой заявки' : 'Выбрать видимые стыки'}
            onChange={onSetVisibleRowsSelected}
          />
        ) : null}
        {hasChainAction ? <WeldTableFilterResetHeader hasColumnFilters={hasColumnFilters} onReset={onResetColumnFilters} /> : null}
        {hasRowActions ? (
          <WeldTableRowActionsHeader label={rowActionsHeaderLabel} screenReaderLabel={rowActionsScreenReaderLabel} />
        ) : null}
        <WeldTableSectionHeaderRow
          sections={filteredSections}
          alwaysVisibleFieldKeys={alwaysVisibleFieldKeys}
          readOnly={readOnly}
          onToggleSection={onToggleSection}
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
  )
}
