import { Check, ListFilter } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { formatDisplayDate, parseDateLikeToIso } from '@/lib/date-format'
import { omitHiddenReportFilters } from '@/lib/report-navigation'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import type { WeldTableDisplaySection } from '@/lib/weld-table-sections'
import { getTableLabel, headerCellClass } from '@/lib/weld-table-utils'
import { FIELD_BY_KEY, type WeldFieldKey } from '@/lib/weld-fields'
import { getStickyWeldTableFieldStyle, isStickyWeldTableField } from '@/lib/weld-table-sticky-columns'
import {
  buildWeldColumnValueFilter,
  filterWeldRowsByColumns,
  getWeldColumnFilterCellText,
  parseWeldColumnChoiceFilter,
} from '@/lib/weld-table-filtering'

const openFilterMenus: Array<{ id: number; close: () => void }> = []
let filterMenuId = 0
let filterMenuEscapeListenerAttached = false

type ColumnFilterOption = {
  value: string
  count: number
  label: string
}

type WeldTableFieldHeaderRowsProps = {
  sections: WeldTableDisplaySection[]
  rows: WeldRow[]
  columnFilters: Record<string, string>
  extraColumns: WeldTableExtraColumn[]
  stickyLeft: number
  stickyIdentityLeadingWidth: number
  stickyIdentityColumns: boolean
  canEditField: (fieldKey: WeldFieldKey) => boolean
  onColumnFiltersChange: (filters: Record<string, string>) => void
}

export function WeldTableFieldHeaderRows({
  sections,
  rows,
  columnFilters,
  extraColumns,
  stickyLeft,
  stickyIdentityLeadingWidth,
  stickyIdentityColumns,
  canEditField,
  onColumnFiltersChange,
}: WeldTableFieldHeaderRowsProps) {
  const trailingExtraColumns = getTrailingExtraColumns(extraColumns, sections)

  return (
    <tr>
      {sections.flatMap((section) => [
        ...extraColumns
          .filter((column) => column.insertBeforeSection === section.section)
          .map((column) => <ExtraFieldHeader key={column.key} column={column} />),
        ...section.fields.map((field, fieldIndex) => {
          const isStickyField = stickyIdentityColumns && isStickyWeldTableField(field.key)
          const isSectionEnd = fieldIndex === section.fields.length - 1
          return (
            <th
              key={field.key}
              className={`${headerCellClass(field.key, !canEditField(field.key as WeldFieldKey), isSectionEnd)} ${
                isStickyField ? 'sticky z-30' : ''
              }`}
              style={isStickyField ? getStickyWeldTableFieldStyle(field.key, stickyLeft, stickyIdentityLeadingWidth) : undefined}
            >
              <WeldColumnFilterControl
                fieldKey={field.key as WeldFieldKey}
                label={getTableLabel(field.key, field.label)}
                rows={rows}
                columnFilters={columnFilters}
                onColumnFiltersChange={onColumnFiltersChange}
              />
            </th>
          )
        }),
      ])}
      {trailingExtraColumns.map((column) => (
        <ExtraFieldHeader key={column.key} column={column} />
      ))}
    </tr>
  )
}

function WeldColumnFilterControl({
  fieldKey,
  label,
  rows,
  columnFilters,
  onColumnFiltersChange,
}: {
  fieldKey: WeldFieldKey
  label: string
  rows: WeldRow[]
  columnFilters: Record<string, string>
  onColumnFiltersChange: (filters: Record<string, string>) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [optionSearch, setOptionSearch] = useState('')
  const menuIdRef = useRef<number | null>(null)
  const filterValue = columnFilters[fieldKey] ?? ''
  const choiceFilter = parseWeldColumnChoiceFilter(filterValue)
  const hasActiveFilter = Boolean(filterValue.trim())
  const filterSummary = getColumnFilterSummary(filterValue, choiceFilter)
  const activeFilterCount = getColumnFilterCount(filterValue, choiceFilter)
  const isDateField = FIELD_BY_KEY.get(fieldKey)?.kind === 'date'
  const options = useMemo(
    () => getColumnFilterOptions(rows, fieldKey, columnFilters).filter((option) => option.label.toLowerCase().includes(optionSearch.trim().toLowerCase())),
    [columnFilters, fieldKey, optionSearch, rows],
  )
  const selectedValues = choiceFilter?.kind === 'values' ? choiceFilter.values : []

  const setFilterValue = (value: string) => {
    const nextFilters = { ...omitHiddenReportFilters(columnFilters) }
    if (value) nextFilters[fieldKey] = value
    else delete nextFilters[fieldKey]
    onColumnFiltersChange(nextFilters)
  }

  const toggleValue = (value: string) => {
    const selectedSet = new Set(selectedValues)
    if (selectedSet.has(value)) selectedSet.delete(value)
    else selectedSet.add(value)
    setFilterValue(selectedSet.size > 0 ? buildWeldColumnValueFilter(Array.from(selectedSet)) : '')
  }

  const toggleValues = (values: string[]) => {
    const selectedSet = new Set(selectedValues)
    const hasEveryValue = values.every((value) => selectedSet.has(value))
    for (const value of values) {
      if (hasEveryValue) selectedSet.delete(value)
      else selectedSet.add(value)
    }
    setFilterValue(selectedSet.size > 0 ? buildWeldColumnValueFilter(Array.from(selectedSet)) : '')
  }

  useEffect(() => {
    if (!isOpen) return undefined
    const id = ++filterMenuId
    menuIdRef.current = id
    const close = () => setIsOpen(false)
    openFilterMenus.push({ id, close })
    ensureFilterMenuEscapeListener()

    return () => {
      const menuIndex = openFilterMenus.findIndex((menu) => menu.id === id)
      if (menuIndex >= 0) openFilterMenus.splice(menuIndex, 1)
      if (menuIdRef.current === id) menuIdRef.current = null
    }
  }, [isOpen])

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={() => {
          setIsOpen((current) => !current)
          setOptionSearch('')
        }}
        className={`group/header-filter relative -mx-1 flex min-h-8 w-[calc(100%+0.5rem)] min-w-0 items-center justify-center rounded-md py-1 text-[13px] font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 ${
          hasActiveFilter || isOpen ? 'bg-white/45 pl-1 pr-8 text-slate-800' : 'px-1 text-slate-700 hover:bg-white/35'
        }`}
        title={hasActiveFilter ? `Фильтр активен: ${filterSummary}` : 'Фильтр по значениям'}
        aria-label={`${label}. Открыть фильтр`}
      >
        <span className="min-w-0 whitespace-normal break-words text-center leading-tight">{label}</span>
        <span
          className={`absolute right-1 top-1/2 inline-flex h-6 min-w-6 -translate-y-1/2 items-center justify-center gap-1 rounded-md border border-[#9fc7de] bg-white/95 px-1.5 text-[11px] font-semibold text-sky-700 shadow-sm shadow-sky-100/70 transition-opacity ${
            hasActiveFilter || isOpen ? 'opacity-100' : 'opacity-0 group-hover/header-filter:opacity-100 group-focus-visible/header-filter:opacity-100'
          }`}
        >
          <ListFilter className="h-3.5 w-3.5" />
          {hasActiveFilter ? <span>{activeFilterCount}</span> : null}
        </span>
      </button>

      {isOpen ? (
        <div className="absolute left-0 top-9 z-50 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-xl shadow-slate-300/40">
          <div className="border-b border-slate-100 bg-slate-50/80 px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-800">Фильтр по значениям</div>
                <div className="mt-0.5 text-xs font-normal text-slate-500">
                  {hasActiveFilter ? `Активно: ${filterSummary}` : `Найдено значений: ${options.length}`}
                </div>
              </div>
              <button type="button" className="text-xs font-normal text-slate-500 hover:text-slate-900" onClick={() => setIsOpen(false)}>
                Закрыть
              </button>
            </div>
          </div>
          <div className="p-3">
            <Input
              value={optionSearch}
              onChange={(event) => setOptionSearch(event.target.value)}
              placeholder="Найти значение"
              className="h-8 rounded-md border-slate-200 bg-white text-xs font-normal shadow-none"
            />
            <div className="mt-2 flex items-center gap-2">
              <FilterQuickButton label="Выбрать все" onClick={() => setFilterValue(buildWeldColumnValueFilter(options.map((option) => option.value)))} />
              <FilterQuickButton label="Очистить" onClick={() => setFilterValue('')} />
            </div>
          </div>
          <div className="max-h-60 overflow-auto border-t border-slate-100">
            {isDateField ? (
              <DateFilterOptions
                options={options}
                selectedValues={selectedValues}
                onToggleValue={toggleValue}
                onToggleValues={toggleValues}
              />
            ) : options.length > 0 ? (
              options.map((option) => {
                const checked = choiceFilter?.kind === 'values' && selectedValues.includes(option.value)
                return (
                  <button
                    key={option.value || '__empty__'}
                    type="button"
                    onClick={() => toggleValue(option.value)}
                    className={`flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs font-normal last:border-b-0 hover:bg-slate-50 ${
                      checked ? 'bg-sky-50/80 text-slate-900' : 'text-slate-700'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 bg-white'
                      }`}
                    >
                      {checked ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-500">{option.count}</span>
                  </button>
                )
              })
            ) : (
              <div className="px-3 py-6 text-center text-xs font-normal text-slate-500">Значений не найдено</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DateFilterOptions({
  options,
  selectedValues,
  onToggleValue,
  onToggleValues,
}: {
  options: ColumnFilterOption[]
  selectedValues: string[]
  onToggleValue: (value: string) => void
  onToggleValues: (values: string[]) => void
}) {
  const groups = getDateFilterGroups(options)
  if (groups.length === 0) {
    return <div className="px-3 py-6 text-center text-xs font-normal text-slate-500">Дат не найдено</div>
  }

  return (
    <div className="divide-y divide-slate-100">
      {groups.map((group) =>
        group.kind === 'empty' ? (
          <FilterValueRow
            key="empty"
            label={group.label}
            count={group.count}
            checked={selectedValues.includes(group.value)}
            onClick={() => onToggleValue(group.value)}
          />
        ) : (
          <div key={group.year} className="py-1">
            <button
              type="button"
              onClick={() => onToggleValues(group.values)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <GroupFilterCheck values={group.values} selectedValues={selectedValues} />
              <span className="min-w-0 flex-1">{group.year}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-500">{group.count}</span>
            </button>
            {group.months.map((month) => (
              <div key={`${group.year}-${month.month}`} className="pb-1">
                <button
                  type="button"
                  onClick={() => onToggleValues(month.values)}
                  className="flex w-full items-center gap-2 px-6 py-1.5 text-left text-xs font-normal text-slate-600 hover:bg-slate-50"
                >
                  <GroupFilterCheck values={month.values} selectedValues={selectedValues} />
                  <span className="min-w-0 flex-1">{month.label}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-500">{month.count}</span>
                </button>
                {month.dates.map((date) => (
                  <FilterValueRow
                    key={date.value || '__empty__'}
                    label={date.label}
                    count={date.count}
                    checked={selectedValues.includes(date.value)}
                    onClick={() => onToggleValue(date.value)}
                    className="pl-9"
                  />
                ))}
              </div>
            ))}
          </div>
        ),
      )}
    </div>
  )
}

function GroupFilterCheck({ values, selectedValues }: { values: string[]; selectedValues: string[] }) {
  const selectedSet = new Set(selectedValues)
  const checkedCount = values.filter((value) => selectedSet.has(value)).length
  const checked = values.length > 0 && checkedCount === values.length
  const partial = checkedCount > 0 && !checked

  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
        checked ? 'border-sky-500 bg-sky-500 text-white' : partial ? 'border-sky-300 bg-sky-50 text-sky-500' : 'border-slate-300 bg-white text-transparent'
      }`}
    >
      {checked ? <Check className="h-3 w-3" /> : partial ? <span className="h-0.5 w-2 rounded-full bg-current" /> : null}
    </span>
  )
}

function FilterValueRow({
  label,
  count,
  checked,
  onClick,
  className = '',
}: {
  label: string
  count: number
  checked: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs font-normal last:border-b-0 hover:bg-slate-50 ${
        checked ? 'bg-sky-50/80 text-slate-900' : 'text-slate-700'
      } ${className}`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          checked ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 bg-white'
        }`}
      >
        {checked ? <Check className="h-3 w-3" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-500">{count}</span>
    </button>
  )
}

function FilterQuickButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-normal text-slate-600 hover:border-slate-300 hover:bg-slate-50"
    >
      {label}
    </button>
  )
}

function ensureFilterMenuEscapeListener() {
  if (filterMenuEscapeListenerAttached || typeof window === 'undefined') return
  filterMenuEscapeListenerAttached = true
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    const firstMenu = openFilterMenus[0]
    if (!firstMenu) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    firstMenu.close()
  }, { capture: true })
}

function getColumnFilterOptions(rows: WeldRow[], fieldKey: WeldFieldKey, columnFilters: Record<string, string>): ColumnFilterOption[] {
  const filtersWithoutCurrent = { ...omitHiddenReportFilters(columnFilters) }
  delete filtersWithoutCurrent[fieldKey]
  const sourceRows = filterWeldRowsByColumns(rows, filtersWithoutCurrent)
  const counts = new Map<string, number>()
  for (const row of sourceRows) {
    const value = getWeldColumnFilterCellText(row[fieldKey]).trim()
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({
      value,
      count,
      label: value || '(пусто)',
    }))
    .sort((left, right) => {
      if (left.value === '') return -1
      if (right.value === '') return 1
      return left.label.localeCompare(right.label, 'ru', { numeric: true, sensitivity: 'base' })
    })
}

function getDateFilterGroups(options: ColumnFilterOption[]) {
  const emptyOptions = options.filter((option) => !parseDateLikeToIso(option.value))
  const dateOptions = options
    .map((option) => ({ option, iso: parseDateLikeToIso(option.value) }))
    .filter((item): item is { option: ColumnFilterOption; iso: string } => Boolean(item.iso))
    .sort((left, right) => left.iso.localeCompare(right.iso))

  const yearGroups = new Map<string, Map<string, ColumnFilterOption[]>>()
  for (const item of dateOptions) {
    const [year, month] = item.iso.split('-')
    if (!yearGroups.has(year)) yearGroups.set(year, new Map())
    const monthGroups = yearGroups.get(year)!
    if (!monthGroups.has(month)) monthGroups.set(month, [])
    monthGroups.get(month)!.push({
      ...item.option,
      label: formatDisplayDate(item.iso),
    })
  }

  const grouped = Array.from(yearGroups.entries())
    .sort(([leftYear], [rightYear]) => rightYear.localeCompare(leftYear))
    .map(([year, months]) => {
      const monthGroups = Array.from(months.entries())
        .sort(([leftMonth], [rightMonth]) => Number(rightMonth) - Number(leftMonth))
        .map(([month, dates]) => ({
          month,
          label: getMonthLabel(month),
          dates,
          values: dates.map((date) => date.value),
          count: dates.reduce((sum, date) => sum + date.count, 0),
        }))
      return {
        kind: 'year' as const,
        year,
        months: monthGroups,
        values: monthGroups.flatMap((month) => month.values),
        count: monthGroups.reduce((sum, month) => sum + month.count, 0),
      }
    })

  return [
    ...emptyOptions.map((option) => ({
      kind: 'empty' as const,
      value: option.value,
      label: option.label,
      count: option.count,
    })),
    ...grouped,
  ]
}

function getMonthLabel(month: string) {
  const labels = [
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь',
  ]
  return labels[Number(month) - 1] ?? month
}

function getColumnFilterSummary(value: string, filter: ReturnType<typeof parseWeldColumnChoiceFilter>) {
  if (filter) {
    if (filter.values.length === 1) return filter.values[0] || '(пусто)'
    return `${filter.values.length}`
  }

  const text = value.trim()
  return text.length > 10 ? `${text.slice(0, 10)}...` : text
}

function getColumnFilterCount(value: string, filter: ReturnType<typeof parseWeldColumnChoiceFilter>) {
  if (filter) return filter.values.length
  return value.trim() ? 1 : 0
}

function ExtraFieldHeader({ column }: { column: WeldTableExtraColumn }) {
  return (
    <th className="border-b border-r border-r-slate-200 bg-slate-100 px-3 py-2.5 text-center text-[13px] font-semibold text-slate-700">
      {column.label}
    </th>
  )
}

function getTrailingExtraColumns(columns: WeldTableExtraColumn[], sections: WeldTableDisplaySection[]) {
  const sectionNames = new Set(sections.map((section) => section.section))
  return columns.filter((column) => !column.insertBeforeSection || !sectionNames.has(column.insertBeforeSection))
}
