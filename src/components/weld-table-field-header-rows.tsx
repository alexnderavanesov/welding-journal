import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { omitHiddenReportFilters } from '@/lib/report-navigation'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import type { WeldTableDisplaySection } from '@/lib/weld-table-sections'
import { filterCellClass, getTableLabel, headerCellClass } from '@/lib/weld-table-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'

type WeldTableFieldHeaderRowsProps = {
  sections: WeldTableDisplaySection[]
  columnFilters: Record<string, string>
  readOnly: boolean
  extraColumns: WeldTableExtraColumn[]
  canEditField: (fieldKey: WeldFieldKey) => boolean
  onColumnFiltersChange: (filters: Record<string, string>) => void
}

export function WeldTableFieldHeaderRows({
  sections,
  columnFilters,
  readOnly,
  extraColumns,
  canEditField,
  onColumnFiltersChange,
}: WeldTableFieldHeaderRowsProps) {
  const trailingExtraColumns = getTrailingExtraColumns(extraColumns, sections)

  return (
    <>
      <tr>
        {sections.flatMap((section) => [
          ...extraColumns
            .filter((column) => column.insertBeforeSection === section.section)
            .map((column) => <ExtraFieldHeader key={column.key} column={column} />),
          ...section.fields.map((field) => (
            <th key={field.key} className={headerCellClass(field.key, !canEditField(field.key as WeldFieldKey))}>
              {getTableLabel(field.key, field.label)}
            </th>
          )),
        ])}
        {trailingExtraColumns.map((column) => (
          <ExtraFieldHeader key={column.key} column={column} />
        ))}
      </tr>
      <tr>
        {sections.flatMap((section) => [
          ...extraColumns
            .filter((column) => column.insertBeforeSection === section.section)
            .map((column) => <ExtraFilterHeader key={`${column.key}-filter`} />),
          ...section.fields.map((field) => (
            <th key={`${field.key}-filter`} className={filterCellClass(field.key, !canEditField(field.key as WeldFieldKey))}>
              <Input
                value={columnFilters[field.key] ?? ''}
                onChange={(event) =>
                  onColumnFiltersChange({
                    ...omitHiddenReportFilters(columnFilters),
                    [field.key]: event.target.value,
                  })
                }
                placeholder="Фильтр"
                className="h-8 w-full min-w-0 rounded-md border-slate-100 bg-white/80 px-2 text-center text-xs font-normal text-slate-600 shadow-none placeholder:text-slate-400 focus-visible:border-slate-300 focus-visible:ring-slate-100"
              />
            </th>
          )),
        ])}
        {trailingExtraColumns.map((column) => (
          <ExtraFilterHeader key={`${column.key}-filter`} />
        ))}
        {!readOnly ? (
          <th className="border-b border-r border-slate-100 px-2 py-1.5">
            <Button variant="ghost" size="sm" onClick={() => onColumnFiltersChange({})} className="h-8 px-2 text-xs">
              Сброс
            </Button>
          </th>
        ) : null}
      </tr>
    </>
  )
}

function ExtraFieldHeader({ column }: { column: WeldTableExtraColumn }) {
  return (
    <th className="border-b border-r border-r-slate-200 bg-slate-100 px-3 py-2.5 text-center text-[13px] font-semibold text-slate-700">
      {column.label}
    </th>
  )
}

function ExtraFilterHeader() {
  return (
    <th className="border-b border-r border-b-slate-100 border-r-slate-200 bg-slate-50/70 px-2 py-1.5">
      <span className="block h-8 rounded-md border border-slate-100 bg-white/50" />
    </th>
  )
}

function getTrailingExtraColumns(columns: WeldTableExtraColumn[], sections: WeldTableDisplaySection[]) {
  const sectionNames = new Set(sections.map((section) => section.section))
  return columns.filter((column) => !column.insertBeforeSection || !sectionNames.has(column.insertBeforeSection))
}
