import { Copy, ExternalLink, FileSpreadsheet, History } from 'lucide-react'

import type { ContextActionMenuItem, ContextActionMenuState } from '@/components/context-action-menu'
import type { WeldRow } from '@/lib/dispatcher-types'

type BuildManagerContextMenuOptions = {
  x: number
  y: number
  heading: string
  description?: string
  documentName: string
  documentLabel: string
  rows: readonly WeldRow[]
  sourceLabel: string
  actions?: ContextActionMenuItem[]
  dangerActions?: ContextActionMenuItem[]
  openDocumentDisabledReason?: string | null
  onOpenDocument: () => void
  onCopyDocumentName: (documentName: string) => void
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
  onOpenPstoHistory?: (row: WeldRow) => void
}

export function buildManagerContextMenu({
  x,
  y,
  heading,
  description,
  documentName,
  documentLabel,
  rows,
  sourceLabel,
  actions = [],
  dangerActions = [],
  openDocumentDisabledReason,
  onOpenDocument,
  onCopyDocumentName,
  onOpenJournalRows,
  onOpenPstoHistory,
}: BuildManagerContextMenuOptions): NonNullable<ContextActionMenuState> {
  const uniqueRows = Array.from(new Map(rows.map((row) => [row.id, row])).values())
  const items: ContextActionMenuItem[] = []

  if (actions.length > 0) {
    items.push({ type: 'label', id: 'actions-label', label: 'Действия' }, ...actions)
  }

  items.push(
    { type: 'label', id: 'document-label', label: 'Документ' },
    {
      id: 'open-document',
      label: `Открыть ${documentLabel}`,
      icon: FileSpreadsheet,
      disabled: Boolean(openDocumentDisabledReason),
      title: openDocumentDisabledReason || undefined,
      onSelect: onOpenDocument,
    },
    {
      id: 'copy-document-name',
      label: 'Скопировать название',
      icon: Copy,
      disabled: !documentName,
      title: documentName ? undefined : 'Название документа не указано',
      onSelect: () => onCopyDocumentName(documentName),
    },
    { type: 'label', id: 'navigation-label', label: 'Переход' },
    ...(onOpenPstoHistory && uniqueRows.length === 1
      ? [{
          id: 'open-psto-history',
          label: 'История ПСТО и ТВМТ',
          icon: History,
          title: 'Открыть полную последовательность ПСТО и ТВМТ для этого стыка',
          onSelect: () => onOpenPstoHistory(uniqueRows[0]!),
        } satisfies ContextActionMenuItem]
      : []),
    {
      id: 'open-in-welding-journal',
      label: uniqueRows.length > 1
        ? `В сварочном журнале, новая вкладка (${uniqueRows.length})`
        : 'В сварочном журнале, новая вкладка',
      icon: ExternalLink,
      disabled: uniqueRows.length === 0,
      title: uniqueRows.length === 0 ? 'В документе нет стыков' : 'Открыть точный состав в новой вкладке',
      onSelect: () => onOpenJournalRows(uniqueRows, sourceLabel),
    },
  )

  if (dangerActions.length > 0) {
    items.push({ type: 'separator', id: 'danger-separator' }, ...dangerActions)
  }

  return { x, y, heading, description, items }
}

export function isNativeContextMenuTarget(target: EventTarget | null) {
  return Boolean(
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, button, [contenteditable="true"]'),
  )
}
