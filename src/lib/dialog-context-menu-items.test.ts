import { describe, expect, it, vi } from 'vitest'

import type { ContextActionMenuItem } from '@/components/context-action-menu'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  buildDialogRowContextMenu,
  buildDocumentGroupContextMenu,
} from '@/lib/dialog-context-menu-items'
import type { SystemDocumentCreationGroup } from '@/lib/system-document-creation-plan'

const rows = [
  { id: 1, projectTitle: 'Проект А', subtitleCode: '500', line: 'L-10', joint: 'F1' },
  { id: 2, projectTitle: 'Проект А', subtitleCode: '500', line: 'L-10', joint: 'F2' },
  { id: 3, projectTitle: 'Проект Б', subtitleCode: '500', line: 'L-10', joint: 'F3' },
] as WeldRow[]

function getAction(items: ContextActionMenuItem[], id: string) {
  const item = items.find((candidate) => candidate.id === id)
  if (!item || item.type === 'label' || item.type === 'separator') throw new Error(`Action ${id} not found`)
  return item
}

function buildRowMenu(row: WeldRow, selectedIds = new Set<number>()) {
  const onSetSelectedRows = vi.fn()
  const onOpenJournalRows = vi.fn()
  const menu = buildDialogRowContextMenu({
    x: 10,
    y: 20,
    row,
    selectedRows: rows.filter((candidate) => selectedIds.has(candidate.id)),
    selectedIds,
    selectableRows: rows,
    isRowSelectable: () => true,
    sourceLabel: 'заявки ЛНК',
    onSetSelectedRows,
    onShowSelectedRows: vi.fn(),
    onClearSelection: vi.fn(),
    onOpenJournalRows,
  })
  return { menu, onSetSelectedRows, onOpenJournalRows }
}

describe('dialog context menu items', () => {
  it('uses the complete selection when opening a selected row in the journal', () => {
    const { menu, onOpenJournalRows } = buildRowMenu(rows[0], new Set([1, 2]))

    getAction(menu.items, 'open-in-welding-journal').onSelect()

    expect(onOpenJournalRows).toHaveBeenCalledWith([rows[0], rows[1]], 'заявки ЛНК')
  })

  it('uses only the context row when it is outside the current selection', () => {
    const { menu, onOpenJournalRows } = buildRowMenu(rows[2], new Set([1, 2]))

    getAction(menu.items, 'open-in-welding-journal').onSelect()

    expect(onOpenJournalRows).toHaveBeenCalledWith([rows[2]], 'заявки ЛНК')
  })

  it('selects only rows from the same project, code and line', () => {
    const { menu, onSetSelectedRows } = buildRowMenu(rows[0])

    getAction(menu.items, 'select-same-line').onSelect()

    expect(onSetSelectedRows).toHaveBeenCalledWith([1, 2])
  })

  it('offers the group and the complete names-tab selection as separate transitions', () => {
    const onOpenJournalRows = vi.fn()
    const group: SystemDocumentCreationGroup = {
      key: 'group-1',
      label: 'Стык F1',
      rowIds: [1],
      rows: [rows[0]],
      name: 'ЗНК-ВИК-001',
      useSystemName: true,
      isMissingValueFallback: false,
    }
    const menu = buildDocumentGroupContextMenu({
      x: 10,
      y: 20,
      group,
      allRows: rows.slice(0, 2),
      sourceLabel: 'результата ЛНК',
      onOpenJournalRows,
    })

    getAction(menu.items, 'open-group-in-welding-journal').onSelect()
    getAction(menu.items, 'open-all-in-welding-journal').onSelect()

    expect(onOpenJournalRows).toHaveBeenNthCalledWith(1, [rows[0]], 'результата ЛНК, группа «Стык F1»')
    expect(onOpenJournalRows).toHaveBeenNthCalledWith(2, [rows[0], rows[1]], 'результата ЛНК')
  })
})
