import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { WeldTableFilterResetHeader, WeldTableRowActions, WeldTableRowNavigation } from '@/components/weld-table-actions'
import { WeldTableBodyCell } from '@/components/weld-table-body-cell'
import { WeldTableColumns } from '@/components/weld-table-columns'
import { WeldTableEditActionsCell } from '@/components/weld-table-edit-actions-cell'
import { WeldTableEmptyRow } from '@/components/weld-table-empty-row'
import { WeldTableFieldHeaderRows } from '@/components/weld-table-field-header-rows'
import { WeldTableRowActionsHeader, WeldTableSelectAllHeader } from '@/components/weld-table-header-cells'
import { WeldTableRowSelectCell } from '@/components/weld-table-row-select-cell'
import { WeldTableSectionToolbar } from '@/components/weld-table-section-toolbar'
import { getWeldTableColumnSpan, getWeldTableMinWidth } from '@/lib/weld-table-layout'
import type { ReportRowActions } from '@/lib/report-row-actions'
import { getWeldTableRowClassName, getWeldTableRowTitle } from '@/lib/weld-table-row-state'
import {
  canCollapseSection,
  getCellKey,
  getDuplicateKeys,
  readCollapsedSections,
  writeCollapsedSections,
} from '@/lib/weld-table-utils'
import { RESULT_FIELD_KEYS, VISIBLE_FIELD_SECTIONS, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'

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
      const finalStatusFields = sections.flatMap((group) => group.fields).filter((field) => field.key === 'finalStatus')
      const sectionsWithoutPsto = sections
        .map((group) => ({
          ...group,
          fields: group.fields.filter((field) => !PSTO_SECTION_FIELD_KEYS.has(field.key) && field.key !== 'finalStatus'),
        }))
        .filter((group) => group.fields.length > 0)
      const resultSection = finalStatusFields.length > 0 ? [{ section: 'Результат', fields: finalStatusFields }] : []
      const weldingIndex = sectionsWithoutPsto.findIndex((group) => group.section === 'Сварка')
      const sectionsWithResult =
        weldingIndex === -1
          ? [...sectionsWithoutPsto, ...resultSection]
          : [
              ...sectionsWithoutPsto.slice(0, weldingIndex + 1),
              ...resultSection,
              ...sectionsWithoutPsto.slice(weldingIndex + 1),
            ]
      const miscIndex = sectionsWithResult.findIndex((group) => group.section === 'Прочее')
      const pstoSection = pstoFields.length > 0 ? [{ section: 'ПСТО', fields: pstoFields }] : []
      if (miscIndex === -1) return [...sectionsWithResult, ...pstoSection]

      return [
        ...sectionsWithResult.slice(0, miscIndex),
        ...pstoSection,
        ...sectionsWithResult.slice(miscIndex),
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
  const hasChainAction = Boolean(onOpenChain || onOpenLinkedReport)
  const hasColumnFilters = Object.values(columnFilters).some((value) => value.trim())
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
  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        Object.entries(columnFilters).every(([key, value]) => {
          const query = value.trim().toLowerCase()
          if (!query) return true
          const cellValue = row[key as keyof typeof row]
          const normalized = cellValue === true ? 'да' : cellValue === false || cellValue == null ? '' : String(cellValue)
          const normalizedText = normalized.trim().toLowerCase()
          if (query.startsWith('=')) {
            return normalizedText === query.slice(1).trim().replace(/^["']|["']$/g, '')
          }
          return normalizedText.includes(query)
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
            <WeldTableFieldHeaderRows
              fields={filteredFields}
              columnFilters={columnFilters}
              readOnly={readOnly}
              canEditField={canEditField}
              onColumnFiltersChange={onColumnFiltersChange}
            />
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <WeldTableEmptyRow colSpan={tableColumnSpan} />
            ) : (
              filteredRows.map((row) => {
                const isDuplicate = duplicateKeys.has(getDuplicateKey(row) ?? '')
                const isHighlighted = highlightedRowIds.has(row.id)
                const isSelected = selectedRowIds.has(row.id)
                const isSelectableRow = !selectable || isRowSelectable(row)

                return (
                <tr
                  key={row.id}
                  className={getWeldTableRowClassName({ readOnly, isHighlighted, isSelected, isDuplicate })}
                  title={getWeldTableRowTitle({ isHighlighted, isDuplicate })}
                >
                  {selectable ? (
                    <WeldTableRowSelectCell
                      label={String(row.joint ?? row.id)}
                      checked={isSelectableRow && isSelected}
                      disabled={!isSelectableRow}
                      onChange={(selected) => setRowSelected(row, selected)}
                    />
                  ) : null}
                  {hasChainAction ? (
                    <WeldTableRowNavigation
                      row={row}
                      onOpenChain={onOpenChain}
                      onOpenLinkedReport={onOpenLinkedReport}
                      openLinkedReportTitle={openLinkedReportTitle}
                    />
                  ) : null}
                  {hasRowActions && rowActions ? (
                    <WeldTableRowActions row={row} rowActions={rowActions} />
                  ) : null}
                  {filteredFields.map((field) => (
                    (() => {
                      const isEditableColumn = canEditField(field.key)
                      const isEditableCell = canEditCell(row, field.key)
                      const isBlockedEditableCell = isEditableColumn && !isEditableCell
                      const isCellHighlighted = highlightedCellKeys.has(getCellKey(row.id, field.key))
                      const isResultField = RESULT_FIELD_KEYS.has(field.key as WeldFieldKey)
                      const displayValue = getDisplayValue(row, field.key)
                      return (
                        <WeldTableBodyCell
                          key={field.key}
                          row={row}
                          field={field}
                          displayValue={displayValue}
                          isEditableCell={isEditableCell}
                          isBlockedEditableCell={isBlockedEditableCell}
                          isHighlightedRow={isHighlighted}
                          isHighlightedCell={isCellHighlighted}
                          isResultField={isResultField}
                          onEdit={onEdit}
                        />
                      )
                    })()
                  ))}
                  {!readOnly ? <WeldTableEditActionsCell row={row} onEdit={onEdit} onDelete={onDelete} /> : null}
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
