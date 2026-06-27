import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { filterCellClass, getTableLabel, headerCellClass } from '@/lib/weld-table-utils'
import type { WeldField, WeldFieldKey } from '@/lib/weld-fields'

type WeldTableFieldHeaderRowsProps = {
  fields: WeldField[]
  columnFilters: Record<string, string>
  readOnly: boolean
  canEditField: (fieldKey: WeldFieldKey) => boolean
  onColumnFiltersChange: (filters: Record<string, string>) => void
}

export function WeldTableFieldHeaderRows({
  fields,
  columnFilters,
  readOnly,
  canEditField,
  onColumnFiltersChange,
}: WeldTableFieldHeaderRowsProps) {
  return (
    <>
      <tr>
        {fields.map((field) => (
          <th key={field.key} className={headerCellClass(field.key, !canEditField(field.key as WeldFieldKey))}>
            {getTableLabel(field.key, field.label)}
          </th>
        ))}
      </tr>
      <tr>
        {fields.map((field) => (
          <th key={`${field.key}-filter`} className={filterCellClass(field.key, !canEditField(field.key as WeldFieldKey))}>
            <Input
              value={columnFilters[field.key] ?? ''}
              onChange={(event) =>
                onColumnFiltersChange({
                  ...columnFilters,
                  [field.key]: event.target.value,
                })
              }
              placeholder="Фильтр"
              className="h-8 w-full min-w-0 rounded-md border-slate-100 bg-white/80 px-2 text-center text-xs font-normal text-slate-600 shadow-none placeholder:text-slate-400 focus-visible:border-slate-300 focus-visible:ring-slate-100"
            />
          </th>
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
