import { useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, FilePlus2, ChevronDown, ChevronRight, Edit2, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ACTIONS_COLUMN_WIDTH, getWeldColumnWidth, getWeldTableWidth, isCompactWeldColumn } from '@/lib/weld-column-widths'
import { RESULT_FIELD_KEYS, VISIBLE_FIELD_SECTIONS, VISIBLE_SECTION_END_FIELD_KEYS, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'

const SELECT_COLUMN_WIDTH = 48
const ROW_ACTIONS_COLUMN_WIDTH = 72
const collapsedSectionsStoragePrefix = 'welding-tracker-collapsed-sections'
const PSTO_SECTION_FIELD_KEYS = new Set<WeldFieldKey>([
  'pstoRequired',
  'pstoRequest',
  'pstoDate',
  'pstoResult',
  'heatTreatmentDiagram',
  'pstoNote',
])
const ALWAYS_VISIBLE_FIELD_KEYS = new Set<WeldFieldKey>([
  'projectTitle',
  'subtitleCode',
  'line',
  'spool',
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
  onEdit?: (row: WeldInput & { id: number }, fieldKey?: WeldFieldKey) => void
  onDelete?: (id: number) => void
  stickyLeft?: number
  highlightedRowIds?: ReadonlySet<number>
  highlightedCellKeys?: ReadonlySet<string>
  readOnly?: boolean
  editableFieldKeys?: ReadonlySet<WeldFieldKey>
  blockedFieldKeys?: ReadonlySet<WeldFieldKey>
  isCellEditable?: (row: WeldInput & { id: number }, fieldKey: WeldFieldKey) => boolean
  selectable?: boolean
  selectedRowIds?: ReadonlySet<number>
  onSelectedRowIdsChange?: (ids: Set<number>) => void
  isRowSelectable?: (row: WeldInput & { id: number }) => boolean
  storageKey?: string
  hiddenFieldKeys?: ReadonlySet<WeldFieldKey>
  mergePstoSections?: boolean
  rowActions?: {
    onCreateRequest: (row: WeldInput & { id: number }) => void
    onAddResult: (row: WeldInput & { id: number }) => void
    canCreateRequest: (row: WeldInput & { id: number }) => boolean
    canAddResult: (row: WeldInput & { id: number }) => boolean
    headerLabel?: string
    createTitle?: string
    createDisabledTitle?: string
    createAriaLabel?: string
    resultTitle?: string
    resultDisabledTitle?: string
    resultAriaLabel?: string
  }
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
  selectable = false,
  selectedRowIds = new Set(),
  onSelectedRowIdsChange,
  isRowSelectable = () => true,
  storageKey = 'default',
  hiddenFieldKeys = new Set(),
  mergePstoSections = false,
  rowActions,
}: WeldTableProps) {
  const [collapsedState, setCollapsedState] = useState(() => ({
    storageKey,
    sections: new Set<string>(),
    hydrated: false,
  }))
  const collapsedSections = collapsedState.storageKey === storageKey ? collapsedState.sections : new Set<string>()

  useEffect(() => {
    setCollapsedState({ storageKey, sections: readCollapsedSections(storageKey), hydrated: true })
  }, [storageKey])

  useEffect(() => {
    if (collapsedState.storageKey !== storageKey) return
    if (!collapsedState.hydrated) return
    writeCollapsedSections(storageKey, collapsedState.sections)
  }, [storageKey, collapsedState])

  const alwaysVisibleFieldKeys = useMemo(() => {
    const fieldKeys = new Set(ALWAYS_VISIBLE_FIELD_KEYS)
    if (mergePstoSections) {
      for (const fieldKey of PSTO_SECTION_FIELD_KEYS) {
        fieldKeys.add(fieldKey)
      }
    }
    return fieldKeys
  }, [mergePstoSections])
  const availableSections = useMemo(
    () => {
      const sections = VISIBLE_FIELD_SECTIONS.map((group) => ({
        ...group,
        fields: group.fields.filter((field) => !hiddenFieldKeys.has(field.key)),
      })).filter((group) => group.fields.length > 0)

      if (!mergePstoSections) return sections

      const pstoFields = sections.flatMap((group) => group.fields).filter((field) => PSTO_SECTION_FIELD_KEYS.has(field.key))
      const sectionsWithoutPsto = sections
        .map((group) => ({
          ...group,
          fields: group.fields.filter((field) => !PSTO_SECTION_FIELD_KEYS.has(field.key)),
        }))
        .filter((group) => group.fields.length > 0)
      const miscIndex = sectionsWithoutPsto.findIndex((group) => group.section === 'Прочее')
      const pstoSection = pstoFields.length > 0 ? [{ section: 'ПСТО', fields: pstoFields }] : []
      if (miscIndex === -1) return [...sectionsWithoutPsto, ...pstoSection]

      return [
        ...sectionsWithoutPsto.slice(0, miscIndex),
        ...pstoSection,
        ...sectionsWithoutPsto.slice(miscIndex),
      ]
    },
    [hiddenFieldKeys, mergePstoSections],
  )
  const filteredSections = useMemo(
    () =>
      availableSections
        .map((group) => ({
          ...group,
          collapsed: collapsedSections.has(group.section) && canCollapseSection(group.fields, alwaysVisibleFieldKeys),
          fields: collapsedSections.has(group.section)
            ? group.fields.filter((field) => alwaysVisibleFieldKeys.has(field.key))
            : group.fields,
        }))
        .filter((group) => group.fields.length > 0),
    [alwaysVisibleFieldKeys, availableSections, collapsedSections],
  )
  const filteredFields = useMemo(() => filteredSections.flatMap((group) => group.fields), [filteredSections])
  const hasRowActions = Boolean(rowActions)
  const tableMinWidth =
    getWeldTableWidth(filteredFields) -
    (readOnly ? ACTIONS_COLUMN_WIDTH : 0) +
    (selectable ? SELECT_COLUMN_WIDTH : 0) +
    (hasRowActions ? ROW_ACTIONS_COLUMN_WIDTH : 0)
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
  const selectableVisibleRows = filteredRows.filter((row) => !selectable || isRowSelectable(row))
  const selectedVisibleRows = selectableVisibleRows.filter((row) => selectedRowIds.has(row.id))
  const allVisibleRowsSelected = selectableVisibleRows.length > 0 && selectedVisibleRows.length === selectableVisibleRows.length
  const someVisibleRowsSelected = selectedVisibleRows.length > 0 && !allVisibleRowsSelected

  function toggleSection(section: string) {
    setCollapsedState((current) => {
      const currentSections =
        current.storageKey === storageKey && current.hydrated ? current.sections : readCollapsedSections(storageKey)
      const next = new Set(currentSections)
      const targetSection = availableSections.find((group) => group.section === section)
      if (!targetSection || !canCollapseSection(targetSection.fields, alwaysVisibleFieldKeys)) {
        next.delete(section)
        return { storageKey, sections: next, hydrated: true }
      }
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return { storageKey, sections: next, hydrated: true }
    })
  }

  function setRowSelected(row: WeldInput & { id: number }, selected: boolean) {
    if (!isRowSelectable(row)) return

    const next = new Set(selectedRowIds)
    if (selected) {
      next.add(row.id)
    } else {
      next.delete(row.id)
    }
    onSelectedRowIdsChange?.(next)
  }

  function setVisibleRowsSelected(selected: boolean) {
    const next = new Set(selectedRowIds)
    for (const row of selectableVisibleRows) {
      if (selected) {
        next.add(row.id)
      } else {
        next.delete(row.id)
      }
    }
    onSelectedRowIdsChange?.(next)
  }

  function canEditField(fieldKey: WeldFieldKey) {
    if (!onEdit) return false
    if (!readOnly) return !blockedFieldKeys.has(fieldKey)
    return editableFieldKeys.has(fieldKey)
  }

  function canEditCell(row: WeldInput & { id: number }, fieldKey: WeldFieldKey) {
    return canEditField(fieldKey) && isCellEditable(row, fieldKey)
  }

  return (
    <div className="w-max space-y-3" style={{ minWidth: tableMinWidth }}>
      <div
        className="sticky z-20 flex flex-wrap items-center gap-2 rounded-md border border-slate-100 bg-white px-3 py-2 shadow-sm shadow-slate-200/30"
        style={{ left: stickyLeft, minWidth: tableMinWidth }}
      >
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Разделы</span>
        {availableSections.map((group) => {
          const canCollapse = canCollapseSection(group.fields, alwaysVisibleFieldKeys)
          const collapsed = canCollapse && collapsedSections.has(group.section)
          const visibleCount = collapsed
            ? group.fields.filter((field) => alwaysVisibleFieldKeys.has(field.key)).length
            : group.fields.length

          return (
            <button
              key={group.section}
              type="button"
              onClick={() => toggleSection(group.section)}
              disabled={!canCollapse}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                !canCollapse
                  ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-500'
                  : collapsed
                  ? 'border-slate-100 bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                  : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200/70'
              }`}
              title={!canCollapse ? 'Обязательные поля всегда показаны' : collapsed ? 'Раскрыть раздел' : 'Скрыть раздел'}
            >
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {group.section}
              <span className="text-slate-400">
                {visibleCount}/{group.fields.length}
              </span>
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
            {selectable ? <col style={{ width: SELECT_COLUMN_WIDTH }} /> : null}
            {hasRowActions ? <col style={{ width: ROW_ACTIONS_COLUMN_WIDTH }} /> : null}
            {filteredFields.map((field) => (
              <col key={field.key} style={{ width: getWeldColumnWidth(field.key) }} />
            ))}
            {!readOnly ? <col style={{ width: ACTIONS_COLUMN_WIDTH }} /> : null}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-50/95 text-left shadow-[inset_0_-1px_0_0_rgb(226,232,240)] backdrop-blur">
            <tr>
              {selectable ? (
                <th
                  rowSpan={3}
                  className="border-r border-slate-200/70 px-2 py-2.5 text-center shadow-[inset_0_1px_0_0_rgb(241,245,249),inset_0_-1px_0_0_rgb(226,232,240)]"
                >
                  <input
                    type="checkbox"
                    checked={allVisibleRowsSelected}
                    disabled={selectableVisibleRows.length === 0}
                    ref={(element) => {
                      if (element) element.indeterminate = someVisibleRowsSelected
                    }}
                    onChange={(event) => setVisibleRowsSelected(event.target.checked)}
                    aria-label="Выбрать видимые стыки"
                    title={selectableVisibleRows.length === 0 ? 'Нет доступных стыков для новой заявки' : 'Выбрать видимые стыки'}
                    className="h-4 w-4 rounded border-slate-300 disabled:cursor-not-allowed disabled:opacity-35"
                  />
                </th>
              ) : null}
              {hasRowActions ? (
                <th
                  rowSpan={3}
                  className="border-r border-slate-200/70 bg-slate-50 px-2 py-2.5 text-center text-xs font-semibold text-slate-500 shadow-[inset_0_1px_0_0_rgb(241,245,249),inset_0_-1px_0_0_rgb(226,232,240)]"
                  title={rowActions?.headerLabel ?? 'Быстрые действия'}
                >
                  <span className="sr-only">{rowActions?.headerLabel ?? 'Действия'}</span>
                </th>
              ) : null}
              {filteredSections.map((group) => {
                const canCollapse = canCollapseSection(group.fields, alwaysVisibleFieldKeys)
                return (
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
                      disabled={!canCollapse}
                      className={`inline-flex items-center gap-1.5 rounded px-2 py-1 transition-colors ${
                        canCollapse ? 'hover:bg-slate-100' : 'cursor-not-allowed'
                      }`}
                      title={!canCollapse ? 'Обязательные поля всегда показаны' : group.collapsed ? 'Раскрыть раздел' : 'Скрыть раздел'}
                    >
                      {group.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {group.section}
                    </button>
                  </th>
                )
              })}
              {!readOnly ? (
                <th
                  rowSpan={2}
                  className="w-24 border-r border-slate-200/70 px-3 py-2.5 text-right text-xs font-semibold text-slate-500 shadow-[inset_0_1px_0_0_rgb(241,245,249),inset_0_-1px_0_0_rgb(226,232,240)]"
                >
                  Действия
                </th>
              ) : null}
            </tr>
            <tr>
              {filteredFields.map((field) => (
                <th key={field.key} className={headerCellClass(field.key, !canEditField(field.key))}>
                  {getTableLabel(field.key, field.label)}
                </th>
              ))}
            </tr>
            <tr>
              {filteredFields.map((field) => (
                <th key={`${field.key}-filter`} className={filterCellClass(field.key, !canEditField(field.key))}>
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
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={filteredFields.length + (readOnly ? 0 : 1) + (selectable ? 1 : 0) + (hasRowActions ? 1 : 0)}
                  className="px-3 py-12 text-center text-muted-foreground"
                >
                  Записи не найдены.
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const isDuplicate = duplicateKeys.has(getDuplicateKey(row) ?? '')
                const isHighlighted = highlightedRowIds.has(row.id)
                const isSelected = selectedRowIds.has(row.id)
                const isSelectableRow = !selectable || isRowSelectable(row)

                return (
                <tr
                  key={row.id}
                  className={`${readOnly ? '' : 'cursor-pointer'} transition-[background-color,box-shadow] duration-300 ${
                    isHighlighted
                      ? 'bg-emerald-100/90 shadow-[inset_4px_0_0_rgb(16,185,129)] hover:bg-emerald-100'
                      : isSelected
                        ? 'bg-sky-50/90 shadow-[inset_4px_0_0_rgb(14,165,233)] hover:bg-sky-50'
                      : isDuplicate
                        ? 'bg-amber-50/80 hover:bg-amber-100/70'
                        : 'hover:bg-slate-50/70'
                  }`}
                  title={
                    isHighlighted
                      ? 'Строка недавно изменена'
                      : isDuplicate
                        ? 'Возможный дубль: совпадают ключевые поля стыка'
                        : undefined
                  }
                >
                  {selectable ? (
                    <td
                      className={`border-b border-r border-b-slate-100 border-r-slate-200 px-2 py-2.5 text-center align-top ${
                        isSelectableRow ? '' : 'bg-slate-200/80 shadow-[inset_0_0_0_9999px_rgba(148,163,184,0.14)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelectableRow && isSelected}
                        disabled={!isSelectableRow}
                        onChange={(event) => setRowSelected(row, event.target.checked)}
                        aria-label={`Выбрать стык ${String(row.joint ?? row.id)}`}
                        title={isSelectableRow ? 'Выбрать стык для заявки ПСТО' : 'Заявка ПСТО уже создана'}
                        className="h-4 w-4 rounded border-slate-300 disabled:cursor-not-allowed disabled:opacity-35"
                      />
                    </td>
                  ) : null}
                  {hasRowActions && rowActions ? (
                    <td className="border-b border-r border-b-slate-100 border-r-slate-200 px-1.5 py-2.5 text-center align-top">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            rowActions.onCreateRequest(row)
                          }}
                          disabled={!rowActions.canCreateRequest(row)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300 disabled:shadow-none"
                          title={
                            rowActions.canCreateRequest(row)
                              ? rowActions.createTitle ?? 'Создать заявку на этот стык'
                              : rowActions.createDisabledTitle ?? 'Заявка по этому стыку уже создана'
                          }
                          aria-label={rowActions.createAriaLabel ?? 'Создать заявку на этот стык'}
                        >
                          <FilePlus2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            rowActions.onAddResult(row)
                          }}
                          disabled={!rowActions.canAddResult(row)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300 disabled:shadow-none"
                          title={
                            rowActions.canAddResult(row)
                              ? rowActions.resultTitle ?? 'Добавить результат на этот стык'
                              : rowActions.resultDisabledTitle ?? 'Сначала создайте заявку на этот стык'
                          }
                          aria-label={rowActions.resultAriaLabel ?? 'Добавить результат на этот стык'}
                        >
                          <ClipboardCheck className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  ) : null}
                  {filteredFields.map((field) => (
                    (() => {
                      const isEditableColumn = canEditField(field.key)
                      const isEditableCell = canEditCell(row, field.key)
                      const isBlockedEditableCell = isEditableColumn && !isEditableCell
                      const isCellHighlighted = highlightedCellKeys.has(getCellKey(row.id, field.key))
                      const isResultField = RESULT_FIELD_KEYS.has(field.key as WeldFieldKey)
                      const contentClass = `block h-full min-h-10 w-full border-0 bg-transparent px-3 py-2.5 text-center text-[13px] font-normal text-slate-700 ${
                        isEditableCell
                          ? 'cursor-pointer hover:bg-slate-100/70'
                          : isResultField
                            ? ''
                            : 'text-slate-500'
                      }`
                      return (
                    <td
                      key={field.key}
                      className={bodyCellClass(field.key, !isEditableCell, isHighlighted, isCellHighlighted, isBlockedEditableCell)}
                      onClick={(event) => {
                        if (!isEditableCell) return
                        event.stopPropagation()
                        onEdit?.(row, field.key)
                      }}
                      title={
                        isEditableCell
                          ? 'Нажмите, чтобы редактировать поле'
                          : isBlockedEditableCell
                            ? 'Недоступно: отсутствует отметка "да" в соответствующем наличии'
                            : undefined
                      }
                    >
                      <div className={contentClass}>
                        {field.kind === 'boolean' ? (
                          isCancelledText(row[field.key]) ? (
                            <CancelledBadge />
                          ) : row[field.key] ? (
                            <YesBadge />
                          ) : (
                            ''
                          )
                        ) : (
                          <span
                            className={
                              field.kind === 'date' ||
                              field.key === 'createdAt' ||
                              field.key === 'pstoCreatedAt' ||
                              field.key === 'lnkCreatedAt' ||
                              isResultField
                                ? 'whitespace-nowrap'
                                : 'line-clamp-2'
                            }
                          >
                            {field.kind === 'date' ? (
                              formatDate(row[field.key])
                            ) : field.key === 'createdAt' || field.key === 'pstoCreatedAt' || field.key === 'lnkCreatedAt' ? (
                              formatDateTime(row[field.key])
                            ) : isResultField ? (
                              <ResultBadge value={row[field.key]} />
                            ) : field.key === 'pstoRequired' && isCancelledText(row[field.key]) ? (
                              <CancelledBadge />
                            ) : field.key === 'pstoRequired' && isYesText(row[field.key]) ? (
                              <YesBadge />
                            ) : field.key === 'pstoRequired' && isNoText(row[field.key]) ? (
                              ''
                            ) : (
                              String(row[field.key] ?? '')
                            )}
                          </span>
                        )}
                      </div>
                    </td>
                      )
                    })()
                  ))}
                  {!readOnly ? (
                    <td className="border-b border-slate-100 px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(event) => {
                            event.stopPropagation()
                            onEdit?.(row)
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
                            onDelete?.(row.id)
                          }}
                          aria-label="Удалить"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  ) : null}
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

function formatDateTime(value: unknown) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${pad(date.getFullYear() % 100)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function headerCellClass(fieldKey: string, isReadOnlyColumn: boolean) {
  const base = 'border-b border-r px-3 py-2.5 text-center text-[13px] font-semibold text-slate-700'
  const width = getWidthClass(fieldKey)
  const border = VISIBLE_SECTION_END_FIELD_KEYS.has(fieldKey as never) ? 'border-r-slate-200' : 'border-r-slate-100'
  const readonly = isReadOnlyColumn ? 'bg-slate-200 text-slate-500 shadow-[inset_0_0_0_9999px_rgba(148,163,184,0.12)]' : ''
  return `${base} ${width} ${border} ${readonly}`
}

function bodyCellClass(
  fieldKey: string,
  isReadOnlyColumn: boolean,
  isHighlightedRow: boolean,
  isHighlightedCell: boolean,
  isBlockedEditableCell = false,
) {
  const base = 'border-b border-r border-b-slate-100 p-0 align-top'
  const width = getWidthClass(fieldKey)
  const border = VISIBLE_SECTION_END_FIELD_KEYS.has(fieldKey as never) ? 'border-r-slate-200' : 'border-r-slate-100'
  const blockedEditable = isBlockedEditableCell
    ? 'bg-stone-100/90 shadow-[inset_0_0_0_9999px_rgba(120,113,108,0.08)]'
    : ''
  const readonly = isReadOnlyColumn
    ? isHighlightedRow
      ? 'bg-emerald-100/80 shadow-[inset_0_0_0_9999px_rgba(148,163,184,0.18)]'
      : 'bg-slate-200/80 shadow-[inset_0_0_0_9999px_rgba(148,163,184,0.14)]'
    : ''
  const highlightedRow = isHighlightedRow && !isReadOnlyColumn ? 'bg-emerald-100/70' : ''
  const highlightedCell = isHighlightedCell ? 'bg-lime-200/95 shadow-[inset_0_0_0_9999px_rgba(190,242,100,0.2)]' : ''
  return `${base} ${width} ${border} ${readonly} ${blockedEditable} ${highlightedRow} ${highlightedCell}`
}

function filterCellClass(fieldKey: string, isReadOnlyColumn: boolean) {
  const base = 'border-b border-r border-b-slate-100 bg-slate-50/70 px-2 py-1.5'
  const border = VISIBLE_SECTION_END_FIELD_KEYS.has(fieldKey as never) ? 'border-r-slate-200' : 'border-r-slate-100'
  const readonly = isReadOnlyColumn ? 'bg-slate-200/90 shadow-[inset_0_0_0_9999px_rgba(148,163,184,0.12)]' : ''
  return `${base} ${border} ${readonly}`
}

function getWidthClass(fieldKey: string) {
  if (fieldKey === 'weldDate') return 'w-28 whitespace-nowrap'
  if (fieldKey === 'pstoDate') return 'w-28 whitespace-nowrap'
  if (fieldKey === 'createdAt' || fieldKey === 'pstoCreatedAt') return 'w-[120px] whitespace-nowrap'
  if (RESULT_FIELD_KEYS.has(fieldKey as WeldFieldKey)) return 'w-28 whitespace-nowrap'
  if (fieldKey === 'finalStatus') return 'w-[116px]'
  if (isCompactWeldColumn(fieldKey)) return 'w-[82px]'
  return 'max-w-72'
}

function canCollapseSection(fields: Array<{ key: WeldFieldKey }>, alwaysVisibleFieldKeys: ReadonlySet<WeldFieldKey>) {
  return fields.some((field) => !alwaysVisibleFieldKeys.has(field.key))
}

function getTableLabel(fieldKey: string, label: string) {
  const tableLabel = fieldKey === 'orderCode1' ? 'ID материала 1' : fieldKey === 'orderCode2' ? 'ID материала 2' : label
  return capitalizeFirstLetter(tableLabel)
}

function capitalizeFirstLetter(value: string) {
  const firstLetterIndex = value.search(/\S/)
  if (firstLetterIndex === -1) return value
  return `${value.slice(0, firstLetterIndex)}${value[firstLetterIndex].toLocaleUpperCase('ru-RU')}${value.slice(firstLetterIndex + 1)}`
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

function getCellKey(rowId: number, fieldKey: WeldFieldKey) {
  return `${rowId}:${fieldKey}`
}

function getCollapsedSectionsStorageKey(storageKey: string) {
  return `${collapsedSectionsStoragePrefix}:${storageKey}`
}

function readCollapsedSections(storageKey: string) {
  if (typeof window === 'undefined') return new Set<string>()

  try {
    const stored = window.localStorage.getItem(getCollapsedSectionsStorageKey(storageKey))
    if (!stored) return new Set<string>()
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? new Set(parsed.filter((value): value is string => typeof value === 'string')) : new Set<string>()
  } catch {
    return new Set<string>()
  }
}

function writeCollapsedSections(storageKey: string, sections: ReadonlySet<string>) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(getCollapsedSectionsStorageKey(storageKey), JSON.stringify([...sections]))
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

function isCancelledText(value: unknown) {
  return String(value ?? '').toLowerCase() === 'отменен'
}

function YesBadge() {
  return <Badge className="bg-background px-2 py-0.5 text-xs font-normal text-slate-600">да</Badge>
}

function CancelledBadge() {
  return <Badge className="bg-amber-50 px-2 py-0.5 text-xs font-normal text-amber-700">отменен</Badge>
}

function ResultBadge({ value }: { value: unknown }) {
  const text = String(value ?? '').trim()
  const normalized = text.toLowerCase()
  if (!text) return ''

  const className =
    normalized === 'годен' || normalized === 'проведено'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : normalized === 'ремонт' || normalized === 'вырез' || normalized === 'не годен' || normalized === 'ошибка'
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : normalized === 'ожидает' || normalized === 'ожидает нк'
          ? 'border-amber-200 bg-amber-50 text-amber-800'
          : 'border-slate-200 bg-slate-50 text-slate-600'

  return (
    <Badge
      variant="outline"
      className={`inline-flex max-w-full whitespace-nowrap px-2.5 py-0.5 text-center text-xs font-normal leading-snug ${className}`}
    >
      {text}
    </Badge>
  )
}
