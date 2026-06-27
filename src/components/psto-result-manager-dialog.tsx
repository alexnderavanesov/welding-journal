import { Pencil, Trash2, X } from 'lucide-react'

import {
  JointProjectSubtitleMeta,
  JointSpoolDiameterMeta,
  JointWeldDateMeta,
  MetaSeparator,
  OfficialityBadge,
} from '@/components/joint-meta'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointStatusBadgeClass, getJointStatusLabel } from '@/lib/lnk-status'
import { getPstoResultBadgeClass, getPstoResultLabel } from '@/lib/report-badges'
import { getJointTitle } from '@/lib/report-ui-state'
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-[1px]">
      <div className="flex max-h-[92vh] w-full max-w-[1180px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Редактирование результатов ПСТО</h2>
            <p className="text-sm text-muted-foreground">
              Переименование диаграммы или удаление результата вместе с датой и диаграммой.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
            <X className="h-4 w-4" />
          </Button>
        </div>

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
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
              Переименование меняет только номер диаграммы у конкретного стыка. Удаление очищает результат, дату ПСТО и
              диаграмму, но оставляет заявку ПСТО.
            </div>
          </section>

          <section className="min-h-0 overflow-auto rounded-md border border-slate-200">
            {rows.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const requestName = String(row.pstoRequest ?? '').trim()
                  const pstoDate = String(row.pstoDate ?? '').trim()
                  const diagramName = String(row.heatTreatmentDiagram ?? '').trim()
                  const diagramDraft = diagramDrafts[row.id] ?? diagramName

                  return (
                    <div
                      key={row.id}
                      className="grid grid-cols-[minmax(420px,1fr)_minmax(230px,0.45fr)] gap-4 px-4 py-3 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="font-medium text-slate-900">{getJointTitle(row)}</span>
                          <OfficialityBadge row={row} compact />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>
                            <JointProjectSubtitleMeta row={row} />
                            <MetaSeparator />
                            <JointSpoolDiameterMeta row={row} />
                            <MetaSeparator />
                            <JointWeldDateMeta row={row} />
                          </span>
                          <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getJointStatusBadgeClass(row)}`}>
                            Стык: {getJointStatusLabel(row)}
                          </span>
                          <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getPstoResultBadgeClass(row.pstoResult)}`}>
                            ПСТО: {getPstoResultLabel(row.pstoResult)}
                          </span>
                        </div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">
                          <span className="font-medium text-slate-700">Заявка:</span>{' '}
                          <span className="break-words">{requestName || '-'}</span>
                          <span className="mx-1 text-slate-300">·</span>
                          <span className="font-medium text-slate-700">Дата:</span> {pstoDate || '-'}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Input
                            value={diagramDraft}
                            onChange={(event) => onDiagramDraftChange(row.id, event.target.value)}
                            placeholder="Наименование диаграммы для этого стыка"
                            disabled={isPending}
                            className="h-8 min-w-72 max-w-xl flex-1 bg-white text-xs"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onRenameDiagram(row)}
                            disabled={isPending || !diagramDraft.trim() || diagramDraft.trim() === diagramName}
                            className="h-8"
                          >
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Переименовать
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-col items-end justify-start gap-2">
                        <span className={`rounded border px-2 py-1 text-xs font-semibold ${getPstoResultBadgeClass(row.pstoResult)}`}>
                          Сейчас: {getPstoResultLabel(row.pstoResult)}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onDeleteResult(row)}
                          disabled={
                            isPending ||
                            (!hasText(row.pstoResult) && !hasText(row.pstoDate) && !hasText(row.heatTreatmentDiagram))
                          }
                          className="border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          Удалить результат
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex min-h-72 items-center justify-center px-4 py-10 text-center text-sm text-slate-500">
                Выберите стыки с результатом ПСТО в окне добавления результата.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
