import { CheckSquare2, ExternalLink, ListFilter, Rows3, X } from 'lucide-react'
import type { MouseEvent } from 'react'

import type { ContextActionMenuItem, ContextActionMenuState } from '@/components/context-action-menu'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { SystemDocumentCreationGroup } from '@/lib/system-document-creation-plan'

type RelatedSelection = {
  label: string
  rows: readonly WeldRow[]
}

type ResultAssignment = {
  values: readonly string[]
  getDisabledReason: (value: string, rows: readonly WeldRow[]) => string | null
  onAssign: (rows: readonly WeldRow[], value: string) => void
}

type BuildDialogRowContextMenuOptions = {
  x: number
  y: number
  row: WeldRow
  selectedRows: readonly WeldRow[]
  selectedIds: ReadonlySet<number>
  selectableRows: readonly WeldRow[]
  isRowSelectable: (row: WeldRow) => boolean
  sourceLabel: string
  relatedSelection?: RelatedSelection
  resultAssignment?: ResultAssignment
  onSetSelectedRows: (rowIds: number[]) => void
  onShowSelectedRows: () => void
  onClearSelection: () => void
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
}

export function buildDialogRowContextMenu({
  x,
  y,
  row,
  selectedRows,
  selectedIds,
  selectableRows,
  isRowSelectable,
  sourceLabel,
  relatedSelection,
  resultAssignment,
  onSetSelectedRows,
  onShowSelectedRows,
  onClearSelection,
  onOpenJournalRows,
}: BuildDialogRowContextMenuOptions): NonNullable<ContextActionMenuState> {
  const rowSelected = selectedIds.has(row.id)
  const contextRows = rowSelected && selectedRows.length > 1 ? selectedRows : [row]
  const contextIds = new Set(contextRows.map((contextRow) => contextRow.id))
  const sameLineRows = getSameLineRows(row, selectableRows)
  const items: ContextActionMenuItem[] = [{ type: 'label', id: 'selection-label', label: 'Выбор' }]

  if (isRowSelectable(row)) {
    items.push({
      id: rowSelected && contextRows.length > 1 ? 'remove-context-selection' : 'toggle-row-selection',
      label: rowSelected
        ? contextRows.length > 1
          ? `Снять выбранные (${contextRows.length})`
          : 'Снять выбор'
        : 'Выбрать стык',
      icon: rowSelected ? X : CheckSquare2,
      onSelect: () => {
        if (rowSelected) {
          onSetSelectedRows([...selectedIds].filter((rowId) => !contextIds.has(rowId)))
        } else {
          onSetSelectedRows([...selectedIds, row.id])
        }
      },
    })
    if (selectedIds.size !== 1 || !rowSelected) {
      items.push({
        id: 'select-only-row',
        label: 'Оставить выбранным только этот',
        icon: ListFilter,
        onSelect: () => onSetSelectedRows([row.id]),
      })
    }
  }

  if (sameLineRows.length > 1) {
    items.push({
      id: 'select-same-line',
      label: `Выбрать доступные на этой линии (${sameLineRows.length})`,
      icon: Rows3,
      onSelect: () => onSetSelectedRows(mergeRowIds(selectedIds, sameLineRows)),
    })
  }

  const relatedRows = uniqueRows(relatedSelection?.rows ?? [])
  if (relatedSelection && relatedRows.length > 1) {
    items.push({
      id: 'select-related-rows',
      label: `${relatedSelection.label} (${relatedRows.length})`,
      icon: CheckSquare2,
      onSelect: () => onSetSelectedRows(mergeRowIds(selectedIds, relatedRows)),
    })
  }

  if (selectedIds.size > 0) {
    items.push({ id: 'selection-separator', type: 'separator' })
    items.push({
      id: 'show-selected',
      label: `Показать выбранные (${selectedIds.size})`,
      icon: ListFilter,
      onSelect: onShowSelectedRows,
    })
    items.push({
      id: 'clear-selection',
      label: 'Снять весь выбор',
      icon: X,
      onSelect: onClearSelection,
    })
  }

  if (resultAssignment && contextRows.every(isRowSelectable)) {
    items.push({ type: 'label', id: 'result-label', label: 'Результат' })
    items.push({
      id: 'assign-result',
      label: contextRows.length > 1 ? `Назначить результат выбранным (${contextRows.length})` : 'Назначить результат стыку',
      icon: CheckSquare2,
      onSelect: () => undefined,
      children: resultAssignment.values.map((value) => {
        const disabledReason = resultAssignment.getDisabledReason(value, contextRows)
        return {
          id: `assign-result-${value}`,
          label: value,
          disabled: Boolean(disabledReason),
          title: disabledReason || undefined,
          onSelect: () => resultAssignment.onAssign(contextRows, value),
        }
      }),
    })
  }

  items.push({ type: 'label', id: 'navigation-label', label: 'Переход' })
  items.push({
    id: 'open-in-welding-journal',
    label: contextRows.length > 1
      ? `В журнале, новая вкладка (${contextRows.length})`
      : 'В журнале, новая вкладка',
    title: 'Открыть выбранные стыки в сварочном журнале в новой вкладке',
    icon: ExternalLink,
    onSelect: () => onOpenJournalRows(contextRows, sourceLabel),
  })

  return {
    x,
    y,
    anchorRowId: row.id,
    ...getRowsIdentity(row, contextRows),
    items: removeEmptyMenuGroups(items),
  }
}

export function buildDocumentGroupContextMenu({
  x,
  y,
  group,
  allRows,
  sourceLabel,
  onOpenJournalRows,
}: {
  x: number
  y: number
  group: SystemDocumentCreationGroup
  allRows: readonly WeldRow[]
  sourceLabel: string
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
}): NonNullable<ContextActionMenuState> {
  const groupRows = uniqueRows(group.rows)
  const selectedRows = uniqueRows(allRows)
  const items: ContextActionMenuItem[] = [
    { type: 'label', id: 'navigation-label', label: 'Переход' },
    {
      id: 'open-group-in-welding-journal',
      label: groupRows.length > 1
        ? `Группа в журнале, новая вкладка (${groupRows.length})`
        : 'Стык в журнале, новая вкладка',
      title: 'Открыть стыки группы в сварочном журнале в новой вкладке',
      icon: ExternalLink,
      onSelect: () => onOpenJournalRows(groupRows, `${sourceLabel}, группа «${group.label}»`),
    },
  ]
  if (!haveSameRowIds(groupRows, selectedRows)) {
    items.push({
      id: 'open-all-in-welding-journal',
      label: `Все в журнале, новая вкладка (${selectedRows.length})`,
      title: 'Открыть все выбранные стыки в сварочном журнале в новой вкладке',
      icon: Rows3,
      onSelect: () => onOpenJournalRows(selectedRows, sourceLabel),
    })
  }

  return {
    x,
    y,
    heading: group.label,
    description: `${groupRows.length} ${formatJointCountLabel(groupRows.length)}${group.name ? ` · ${group.name}` : ''}`,
    items,
  }
}

export function getDialogMenuPoint(event: MouseEvent<HTMLElement>) {
  event.preventDefault()
  event.stopPropagation()
  if (event.type === 'contextmenu' && (event.clientX !== 0 || event.clientY !== 0)) {
    return { x: event.clientX, y: event.clientY }
  }
  const rect = event.currentTarget.getBoundingClientRect()
  return { x: rect.right - 8, y: rect.bottom + 4 }
}

function getRowsIdentity(row: WeldRow, rows: readonly WeldRow[]) {
  if (rows.length > 1) {
    const lines = new Set(rows.map((item) => String(item.line ?? '').trim()).filter(Boolean))
    return {
      heading: `Выбрано стыков: ${rows.length}`,
      description: lines.size === 1 ? `Линия ${Array.from(lines)[0]}` : 'Групповые действия',
    }
  }
  const joint = String(row.joint ?? '').trim()
  const line = String(row.line ?? '').trim()
  return {
    heading: joint ? `Стык ${joint}` : 'Действия по строке',
    description: line ? `Линия ${line}` : undefined,
  }
}

function getSameLineRows(row: WeldRow, rows: readonly WeldRow[]) {
  const identity = getLineIdentity(row)
  if (!identity.line) return []
  return uniqueRows(rows.filter((candidate) => {
    const candidateIdentity = getLineIdentity(candidate)
    return candidateIdentity.project === identity.project && candidateIdentity.code === identity.code && candidateIdentity.line === identity.line
  }))
}

function getLineIdentity(row: WeldRow) {
  return {
    project: String(row.projectTitle ?? '').trim(),
    code: String(row.subtitleCode ?? '').trim(),
    line: String(row.line ?? '').trim(),
  }
}

function mergeRowIds(currentIds: ReadonlySet<number>, rows: readonly WeldRow[]) {
  return Array.from(new Set([...currentIds, ...rows.map((row) => row.id)]))
}

function uniqueRows(rows: readonly WeldRow[]) {
  return Array.from(new Map(rows.map((row) => [row.id, row])).values())
}

function haveSameRowIds(left: readonly WeldRow[], right: readonly WeldRow[]) {
  if (left.length !== right.length) return false
  const rightIds = new Set(right.map((row) => row.id))
  return left.every((row) => rightIds.has(row.id))
}

function formatJointCountLabel(count: number) {
  const lastTwo = count % 100
  const last = count % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 'стыков'
  if (last === 1) return 'стык'
  if (last >= 2 && last <= 4) return 'стыка'
  return 'стыков'
}

function removeEmptyMenuGroups(items: ContextActionMenuItem[]) {
  const withoutEmptyLabels = items.filter((item, index, list) => {
    if (item.type !== 'label') return true
    const next = list[index + 1]
    return Boolean(next && next.type !== 'label' && next.type !== 'separator')
  })
  return withoutEmptyLabels.filter((item, index, list) => (
    item.type !== 'separator' || (
      index > 0 &&
      index < list.length - 1 &&
      list[index - 1]?.type !== 'separator' &&
      list[index + 1]?.type !== 'separator'
    )
  ))
}
