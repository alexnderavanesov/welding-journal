import { DialogHelpNote } from '@/components/dialog-help-note'
import { DialogHeader } from '@/components/dialog-header'
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
          <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Что редактируем</h3>
            <div className="space-y-2 text-sm text-slate-600">
              <div className="rounded border border-slate-200 bg-white px-3 py-2">
                Выбрано стыков: <span className="font-semibold text-slate-900">{rows.length}</span>
              </div>
              <div className="rounded border border-slate-200 bg-white px-3 py-2">
                С результатом: <span className="font-semibold text-slate-900">{resultCount}</span>
              </div>
            </div>
          </div>
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
            <div className="flex min-h-72 items-center justify-center px-4 py-10 text-center text-sm text-slate-500">
              Выберите стыки с результатом ПСТО в окне добавления результата.
            </div>
          )}
        </section>
      </div>
    </LargeDialogShell>
  )
}
