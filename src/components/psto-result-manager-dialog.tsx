import { useRef, type MouseEvent } from 'react'
import { Pencil, Trash2 } from 'lucide-react'

import { DialogContextMenuLayer, type DialogContextMenuLayerHandle } from '@/components/dialog-context-menu-layer'
import { DialogHelpNote } from '@/components/dialog-help-note'
import { DialogEmptyState } from '@/components/dialog-empty-state'
import { DialogHeader } from '@/components/dialog-header'
import { DialogSummaryPanel, DialogSummaryStat } from '@/components/dialog-summary-panel'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { PstoResultManagerEntry } from '@/components/psto-result-manager-entry'
import { Button } from '@/components/ui/button'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getDialogMenuPoint } from '@/lib/dialog-context-menu-items'
import { buildManagerContextMenu, isNativeContextMenuTarget } from '@/lib/manager-context-menu-items'
import { formatCustomDocumentName } from '@/lib/report-request-naming'
import { hasText } from '@/lib/report-value-utils'

export type PstoResultManagerDialogProps = {
  rows: WeldRow[]
  diagramDrafts: Record<number, string>
  isPending: boolean
  canOpenDocument: boolean
  onClose: () => void
  onDiagramDraftChange: (rowId: number, value: string) => void
  onRenameDiagram: (row: WeldRow, diagramName: string) => void
  onDeleteResult: (row: WeldRow) => void
  onOpenDocument: (row: WeldRow) => void
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
  onCopyDocumentName: (documentName: string) => void
}

export function PstoResultManagerDialog({
  rows,
  diagramDrafts,
  isPending,
  canOpenDocument,
  onClose,
  onDiagramDraftChange,
  onRenameDiagram,
  onDeleteResult,
  onOpenDocument,
  onOpenJournalRows,
  onCopyDocumentName,
}: PstoResultManagerDialogProps) {
  const contextMenuRef = useRef<DialogContextMenuLayerHandle>(null)
  const resultCount = rows.filter((row) => hasText(row.pstoResult)).length
  const openResultContextMenu = (event: MouseEvent<HTMLElement>, row: WeldRow) => {
    if (isNativeContextMenuTarget(event.target)) return
    const point = getDialogMenuPoint(event)
    const diagramName = String(row.heatTreatmentDiagram ?? '').trim()
    const diagramDraft = formatCustomDocumentName(diagramDrafts[row.id] ?? diagramName)
    const hasResultData = hasText(row.pstoResult) || hasText(row.pstoDate) || hasText(row.heatTreatmentDiagram)
    const documentReason = !diagramName
      ? 'Диаграмма не указана'
      : !canOpenDocument
        ? 'Сначала загрузите шаблон диаграммы ПСТО в настройках документов'
        : null

    contextMenuRef.current?.open(buildManagerContextMenu({
      ...point,
      heading: `${String(row.line ?? '-').trim() || '-'} · ${String(row.joint ?? '-').trim() || '-'}`,
      description: String(row.pstoResult ?? '').trim() || 'Результат не указан',
      documentName: diagramName,
      documentLabel: 'диаграмму',
      rows: [row],
      sourceLabel: `результат ПСТО · стык ${String(row.joint ?? row.id)}`,
      actions: [{
        id: 'rename-diagram',
        label: 'Переименовать диаграмму',
        icon: Pencil,
        disabled: isPending || !diagramDraft || diagramDraft === diagramName,
        title: !diagramDraft || diagramDraft === diagramName
          ? 'Сначала введите новое название в строке результата'
          : undefined,
        onSelect: () => onRenameDiagram(row, diagramDraft),
      }],
      dangerActions: [{
        id: 'delete-result',
        label: 'Удалить результат',
        icon: Trash2,
        danger: true,
        disabled: isPending || !hasResultData,
        onSelect: () => onDeleteResult(row),
      }],
      openDocumentDisabledReason: documentReason,
      onOpenDocument: () => onOpenDocument(row),
      onCopyDocumentName,
      onOpenJournalRows,
    }))
  }

  return (
    <LargeDialogShell maxWidthClassName="max-w-[1180px]">
      <DialogHeader
        title="Редактирование результатов ПСТО"
        subtitle="Переименование диаграммы или удаление результата вместе с датой и диаграммой."
        onClose={onClose}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-5 py-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
          <DialogSummaryPanel title="Что редактируем">
            <div className="space-y-2 text-sm text-slate-600">
              <DialogSummaryStat label="Выбрано стыков" value={rows.length} />
              <DialogSummaryStat label="С результатом" value={resultCount} />
            </div>
          </DialogSummaryPanel>
          <DialogHelpNote>
            Переименование меняет только номер диаграммы у конкретного стыка. Удаление очищает результат, дату ПСТО и
            диаграмму, но оставляет заявку ПСТО.
          </DialogHelpNote>
        </section>

        <section className="min-h-0 overflow-auto rounded-md border border-slate-200">
          {rows.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {rows.map((row) => (
                <PstoResultManagerEntry
                  key={row.id}
                  row={row}
                  diagramDraft={diagramDrafts[row.id] ?? String(row.heatTreatmentDiagram ?? '').trim()}
                  isPending={isPending}
                  onDiagramDraftChange={onDiagramDraftChange}
                  onRenameDiagram={onRenameDiagram}
                  onDeleteResult={onDeleteResult}
                  onOpenContextMenu={openResultContextMenu}
                />
              ))}
            </div>
          ) : (
            <DialogEmptyState>
              Выберите стыки с результатом ПСТО в окне добавления результата.
            </DialogEmptyState>
          )}
        </section>
      </div>
      <DialogContextMenuLayer ref={contextMenuRef} />
    </LargeDialogShell>
  )
}
