import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Edit2, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ACTIONS_COLUMN_WIDTH, getWeldColumnWidth, getWeldTableWidth, isCompactWeldColumn } from '@/lib/weld-column-widths'
import { VISIBLE_FIELD_SECTIONS, VISIBLE_SECTION_END_FIELD_KEYS, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'

const ALWAYS_VISIBLE_FIELD_KEYS = new Set<WeldFieldKey>([
  'projectTitle',
  'subtitleCode',
  'line',
  'joint',
  'wdi',
  'weldDate',
  'finalStatus',
])

const DUPLICATE_CHECK_FIELD_KEYS: WeldFieldKey[] = [
  'projectTitle',
  'subtitleCode',
  'line',
  'groupName',
  'category',
  'weldControlPercent',
  'isometry',
  'sheet',
  'revisionNumber',
  'revisionActuality',
  'spool',
  'spoolId',
  'joint',
]

type WeldTableProps = {
  rows: Array<WeldInput & { id: number }>
  columnFilters: Record<string, string>
  onColumnFiltersChange: (filters: Record<string, string>) => void
  onEdit: (row: WeldInput & { id: number }, fieldKey?: WeldFieldKey) => void
  onDelete: (id: number) => void
  stickyLeft?: number
}

export function WeldTable({ rows, columnFilters, onColumnFiltersChange, onEdit, onDelete, stickyLeft = 0 }: WeldTableProps) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const filteredSections = useMemo(
    () =>
      VISIBLE_FIELD_SECTIONS.map((group) => ({
        ...group,
        collapsed: collapsedSections.has(group.section),
        fields: collapsedSections.has(group.section)
          ? group.fields.filter((field) => ALWAYS_VISIBLE_FIELD_KEYS.has(field.key))
          : group.fields,
      })).filter((group) => group.fields.length > 0),
    [collapsedSections],
  )
  const filteredFields = useMemo(() => filteredSections.flatMap((group) => group.fields), [filteredSections])
  const tableMinWidth = getWeldTableWidth(filteredFields)
  const duplicateKeys = useMemo(() => getDuplicateKeys(rows), [rows])
  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        Object.entries(columnFilters).every(([key, value]) => {
          const query = value.trim().toLowerCase()
          if (!query) return true
          const cellValue = row[key as keyof typeof row]
          const normalized = cellValue === true ? 'да' : cellValue === false || cellValue == null ? '' : String(cellValue)
          return normalized.toLowerCase().includes(query)
        }),
      ),
    [rows, columnFilters],
  )

  function toggleSection(section: string) {
    setCollapsedSections((current) => {
      const next = new Set(current)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  return (
    <div className="w-max space-y-3" style={{ minWidth: tableMinWidth }}>
      <div
        className="sticky z-20 flex flex-wrap items-center gap-2 rounded-md border border-slate-100 bg-white px-3 py-2 shadow-sm shadow-slate-200/30"
        style={{ left: stickyLeft, minWidth: tableMinWidth }}
      >
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Разделы</span>
        {VISIBLE_FIELD_SECTIONS.map((group) => {
          const collapsed = collapsedSections.has(group.section)
          const visibleCount = collapsed
            ? group.fields.filter((field) => ALWAYS_VISIBLE_FIELD_KEYS.has(field.key)).length
            : group.fields.length

          return (
            <button
              key={group.section}
              type="button"
              onClick={() => toggleSection(group.section)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                collapsed
                  ? 'border-slate-100 bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                  : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200/70'
              }`}
              title={collapsed ? 'Раскрыть раздел' : 'Скрыть раздел'}
            >
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {group.section}
              <span className="text-slate-400">{visibleCount}/{group.fields.length}</span>
            </button>
          )
        })}
      </div>
      <div className="rounded-md border border-slate-100 bg-card shadow-sm shadow-slate-200/30" style={{ minWidth: tableMinWidth }}>
        <table
          className="table-fixed border-separate border-spacing-0 text-sm text-slate-700 [&_td]:outline-none [&_th]:outline-none"
          style={{ width: tableMinWidth }}
        >
          <colgroup>
            {filteredFields.map((field) => (
              <col key={field.key} style={{ width: getWeldColumnWidth(field.key) }} />
            ))}
            <col style={{ width: ACTIONS_COLUMN_WIDTH }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-50/95 text-left shadow-[inset_0_-1px_0_0_rgb(226,232,240)] backdrop-blur">
            <tr>
              {filteredSections.map((group) => (
                <th
                  key={group.section}
                  colSpan={group.fields.length}
                  className={`border-r border-slate-200/70 px-3 py-3 text-center text-[13px] font-bold tracking-wide shadow-[inset_0_1px_0_0_rgb(241,245,249),inset_0_-1px_0_0_rgb(226,232,240)] ${
                    group.collapsed ? 'bg-slate-50 text-slate-500' : 'text-slate-700'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSection(group.section)}
                    className="inline-flex items-center gap-1.5 rounded px-2 py-1 transition-colors hover:bg-slate-100"
                    title={group.collapsed ? 'Раскрыть раздел' : 'Скрыть раздел'}
                  >
                    {group.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {group.section}
                  </button>
                </th>
              ))}
              <th
                rowSpan={2}
                className="w-24 border-r border-slate-200/70 px-3 py-2.5 text-right text-xs font-semibold text-slate-500 shadow-[inset_0_1px_0_0_rgb(241,245,249),inset_0_-1px_0_0_rgb(226,232,240)]"
              >
                Действия
              </th>
            </tr>
            <tr>
              {filteredFields.map((field) => (
                <th key={field.key} className={headerCellClass(field.key)}>
                  {getTableLabel(field.key, field.label)}
                </th>
              ))}
            </tr>
            <tr>
              {filteredFields.map((field) => (
                <th key={`${field.key}-filter`} className={filterCellClass(field.key)}>
                  <Input
                    value={columnFilters[field.key] ?? ''}
                    onChange={(event) =>
                      onColumnFiltersChange({
                        ...columnFilters,
                        [field.key]: event.target.value,
                      })
                    }
                    placeholder="Фильтр"
                    className="h-8 w-full min-w-0 rounded-md border-slate-100 bg-white/80 px-2 text-xs font-normal text-slate-600 shadow-none placeholder:text-slate-400 focus-visible:border-slate-300 focus-visible:ring-slate-100"
                  />
                </th>
              ))}
              <th className="border-b border-r border-slate-100 px-2 py-1.5">
                <Button variant="ghost" size="sm" onClick={() => onColumnFiltersChange({})} className="h-8 px-2 text-xs">
                  Сброс
                </Button>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={filteredFields.length + 1} className="px-3 py-12 text-center text-muted-foreground">
                  Записи не найдены.
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const isDuplicate = duplicateKeys.has(getDuplicateKey(row) ?? '')

                return (
                <tr
                  key={row.id}
                  className={`cursor-pointer transition-colors duration-150 ${
                    isDuplicate ? 'bg-amber-50/80 hover:bg-amber-100/70' : 'hover:bg-slate-50/70'
                  }`}
                  title={isDuplicate ? 'Возможный дубль: совпадают ключевые поля стыка' : undefined}
                >
                  {filteredFields.map((field) => (
                    <td
                      key={field.key}
                      className={bodyCellClass(field.key)}
                      onClick={(event) => {
                        event.stopPropagation()
                        onEdit(row, field.key)
                      }}
                      title="Нажмите, чтобы редактировать стык"
                    >
                      <button
                        type="button"
                        className="block h-full min-h-10 w-full border-0 bg-transparent px-3 py-2.5 text-left text-[13px] font-normal text-slate-700"
                        onClick={(event) => {
                          event.stopPropagation()
                          onEdit(row, field.key)
                        }}
                      >
                        {field.kind === 'boolean' ? (
                          row[field.key] ? (
                            <YesBadge />
                          ) : (
                            ''
                          )
                        ) : (
                          <span className={field.key === 'weldDate' ? 'whitespace-nowrap' : 'line-clamp-2'}>
                            {field.key === 'weldDate' ? (
                              formatDate(row[field.key])
                            ) : field.key === 'pstoRequired' && isYesText(row[field.key]) ? (
                              <YesBadge />
                            ) : field.key === 'pstoRequired' && isNoText(row[field.key]) ? (
                              ''
                            ) : (
                              String(row[field.key] ?? '')
                            )}
                          </span>
                        )}
                      </button>
                    </td>
                  ))}
                  <td className="border-b border-slate-100 px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(event) => {
                          event.stopPropagation()
                          onEdit(row)
                        }}
                        aria-label="Редактировать"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(event) => {
                          event.stopPropagation()
                          onDelete(row.id)
                        }}
                        aria-label="Удалить"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatDate(value: unknown) {
  if (!value) return ''
  const text = String(value)
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[3]}.${match[2]}.${match[1]}`
  return text
}

function headerCellClass(fieldKey: string) {
  const base = 'border-b border-r px-3 py-2.5 text-[13px] font-semibold text-slate-700'
  const width = getWidthClass(fieldKey)
  const border = VISIBLE_SECTION_END_FIELD_KEYS.has(fieldKey as never) ? 'border-r-slate-200' : 'border-r-slate-100'
  return `${base} ${width} ${border}`
}

function bodyCellClass(fieldKey: string) {
  const base = 'border-b border-r border-b-slate-100 p-0 align-top'
  const width = getWidthClass(fieldKey)
  const border = VISIBLE_SECTION_END_FIELD_KEYS.has(fieldKey as never) ? 'border-r-slate-200' : 'border-r-slate-100'
  return `${base} ${width} ${border}`
}

function filterCellClass(fieldKey: string) {
  const base = 'border-b border-r border-b-slate-100 bg-slate-50/70 px-2 py-1.5'
  const border = VISIBLE_SECTION_END_FIELD_KEYS.has(fieldKey as never) ? 'border-r-slate-200' : 'border-r-slate-100'
  return `${base} ${border}`
}

function getWidthClass(fieldKey: string) {
  if (fieldKey === 'weldDate') return 'w-28 whitespace-nowrap'
  if (fieldKey === 'finalStatus') return 'w-[116px]'
  if (isCompactWeldColumn(fieldKey)) return 'w-[82px]'
  return 'max-w-72'
}

function getTableLabel(fieldKey: string, label: string) {
  if (fieldKey === 'orderCode1') return 'ID материала 1'
  if (fieldKey === 'orderCode2') return 'ID материала 2'
  return label
}

function getDuplicateKeys(rows: Array<WeldInput & { id: number }>) {
  const counts = new Map<string, number>()

  for (const row of rows) {
    const key = getDuplicateKey(row)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key))
}

function getDuplicateKey(row: WeldInput) {
  const values = DUPLICATE_CHECK_FIELD_KEYS.map((key) => normalizeDuplicateValue(row[key]))
  if (values.every((value) => value === '')) return null
  return values.join('|')
}

function normalizeDuplicateValue(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase()
}

function isYesText(value: unknown) {
  return String(value ?? '').toLowerCase() === 'да'
}

function isNoText(value: unknown) {
  return String(value ?? '').toLowerCase() === 'нет'
}

function YesBadge() {
  return <Badge className="bg-background px-2 py-0.5 text-xs font-normal text-slate-600">да</Badge>
}
