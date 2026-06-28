import { DialogHelpNote } from '@/components/dialog-help-note'
import { DialogEmptyState } from '@/components/dialog-empty-state'
import { DialogHeader } from '@/components/dialog-header'
import { DialogSummaryPanel, DialogSummaryStat } from '@/components/dialog-summary-panel'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { PstoResultManagerEntry } from '@/components/psto-result-manager-entry'
import { Button } from '@/components/ui/button'
import type { WeldRow } from '@/lib/dispatcher-types'
import { hasText } from '@/lib/report-value-utils'

export type PstoResultManagerDialogProps = {
  rows: WeldRow[]
  diagramDrafts: Record<number, string>
  isPending: boolean
  onClose: () => void
  onDiagramDraftChange: (rowId: number, value: string) => void
  onRenameDiagram: (row: WeldRow) => void
  onDeleteResult: (row: WeldRow) => void
}

export function PstoResultManagerDialog({
  rows,
  diagramDrafts,
  isPending,
  onClose,
  onDiagramDraftChange,
  onRenameDiagram,
  onDeleteResult,
}: PstoResultManagerDialogProps) {
  const resultCount = rows.filter((row) => hasText(row.pstoResult)).length

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
    </LargeDialogShell>
  )
}
