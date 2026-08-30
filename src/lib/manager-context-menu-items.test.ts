import { describe, expect, it, vi } from 'vitest'

import type { ContextActionMenuItem } from '@/components/context-action-menu'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildManagerContextMenu } from '@/lib/manager-context-menu-items'

function getAction(items: ContextActionMenuItem[], id: string) {
  const item = items.find((candidate) => candidate.id === id)
  if (!item || item.type === 'label' || item.type === 'separator') throw new Error(`Action ${id} not found`)
  return item
}

describe('manager context menu items', () => {
  it('uses the exact document rows for journal navigation', () => {
    const rows = [{ id: 1 }, { id: 1 }, { id: 2 }] as WeldRow[]
    const onOpenJournalRows = vi.fn()
    const menu = buildManagerContextMenu({
      x: 10,
      y: 20,
      heading: 'Заявка-001',
      documentName: 'Заявка-001',
      documentLabel: 'заявку',
      rows,
      sourceLabel: 'заявка ЛНК «Заявка-001»',
      onOpenDocument: vi.fn(),
      onCopyDocumentName: vi.fn(),
      onOpenJournalRows,
    })

    getAction(menu.items, 'open-in-welding-journal').onSelect()

    expect(onOpenJournalRows).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 })],
      'заявка ЛНК «Заявка-001»',
    )
  })

  it('keeps unavailable document actions visible with their reason', () => {
    const menu = buildManagerContextMenu({
      x: 10,
      y: 20,
      heading: 'Результат',
      documentName: '',
      documentLabel: 'заключение',
      rows: [],
      sourceLabel: 'результат ЛНК',
      openDocumentDisabledReason: 'Заключение не указано',
      onOpenDocument: vi.fn(),
      onCopyDocumentName: vi.fn(),
      onOpenJournalRows: vi.fn(),
    })

    expect(getAction(menu.items, 'open-document')).toMatchObject({
      disabled: true,
      title: 'Заключение не указано',
    })
    expect(getAction(menu.items, 'copy-document-name').disabled).toBe(true)
    expect(getAction(menu.items, 'open-in-welding-journal').disabled).toBe(true)
  })

  it('offers PSTO history only when the manager action points to one exact joint', () => {
    const row = { id: 7, joint: 'F7' } as WeldRow
    const onOpenPstoHistory = vi.fn()
    const menu = buildManagerContextMenu({
      x: 10,
      y: 20,
      heading: 'Результат',
      documentName: 'ЗНК-007',
      documentLabel: 'заключение',
      rows: [row],
      sourceLabel: 'результат ЛНК',
      onOpenDocument: vi.fn(),
      onCopyDocumentName: vi.fn(),
      onOpenJournalRows: vi.fn(),
      onOpenPstoHistory,
    })

    getAction(menu.items, 'open-psto-history').onSelect()

    expect(onOpenPstoHistory).toHaveBeenCalledWith(row)
  })
})
