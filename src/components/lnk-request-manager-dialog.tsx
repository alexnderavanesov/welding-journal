import { Pencil, Trash2, X } from 'lucide-react'

import { LnkRequestManagerPosition } from '@/components/lnk-request-manager-position'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/report-config'
import { getLnkRowRequestMethods } from '@/lib/report-modal-rows'

type LnkRequestMethod = (typeof LNK_METHODS)[number]

export type LnkRequestManagerDialogProps = {
  requestName: string
  requestOptions: string[]
  requestRows: WeldRow[]
  requestMethods: LnkRequestMethod[]
  requestNameDraft: string
  isManagerPending: boolean
  isCorrectionPending: boolean
  onClose: () => void
  onChangeRequest: (requestName: string) => void
  onRequestNameDraftChange: (requestName: string) => void
  onRenameRequest: () => void
  onClearPosition: (row: WeldRow, requestKey: LnkRequestMethod['requestKey']) => void
  onDeleteRequest: () => void
}

export function LnkRequestManagerDialog({
  requestName,
  requestOptions,
  requestRows,
  requestMethods,
  requestNameDraft,
  isManagerPending,
  isCorrectionPending,
  onClose,
  onChangeRequest,
  onRequestNameDraftChange,
  onRenameRequest,
  onClearPosition,
  onDeleteRequest,
}: LnkRequestManagerDialogProps) {
  const positionCount = LNK_METHODS.reduce(
    (count, method) => count + requestRows.filter((row) => String(row[method.requestKey] ?? '').trim() === requestName).length,
    0,
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-[1px]">
      <div className="flex max-h-[90vh] w-full max-w-[920px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Управление заявками ЛНК</h2>
            <p className="text-sm text-muted-foreground">Переименование и удаление уже созданных заявок.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 space-y-4 overflow-auto px-5 py-4">
          <label className="block space-y-1.5 text-sm">
            <span className="text-[13px] font-medium leading-none text-slate-700">Заявка ЛНК</span>
            <Select value={requestName} onChange={(event) => onChangeRequest(event.target.value)}>
              <option value="">Выберите заявку</option>
              {requestOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </label>

          {requestName ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-slate-800">Используется:</span>
                <span className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600">
                  Стыков: {requestRows.length}
                </span>
                <span className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600">
                  Позиций: {positionCount}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {requestMethods.map((method) => (
                  <span
                    key={method.requestKey}
                    className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800"
                  >
                    {method.code}: {requestRows.filter((row) => String(row[method.requestKey] ?? '').trim() === requestName).length}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              Созданных заявок ЛНК пока нет.
            </div>
          )}

          <div className="rounded-md border border-slate-200 bg-white p-3">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Переименовать заявку</h3>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={requestNameDraft}
                onChange={(event) => onRequestNameDraftChange(event.target.value)}
                placeholder="Новое наименование заявки"
                disabled={!requestName || isManagerPending}
                className="h-10 flex-1"
              />
              <Button
                onClick={onRenameRequest}
                disabled={!requestName || !requestNameDraft.trim() || requestNameDraft.trim() === requestName || isManagerPending}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Переименовать
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-3">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-slate-800">Очистить конкретную позицию</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Можно удалить заявку только у выбранного стыка и метода контроля, не затрагивая остальные позиции заявки.
              </p>
            </div>
            {requestName && requestRows.length > 0 ? (
              <div className="max-h-72 overflow-auto rounded-md border border-slate-200">
                <div className="divide-y divide-slate-100">
                  {requestRows.map((row) => {
                    const methods = getLnkRowRequestMethods(row, requestName)
                    return (
                      <LnkRequestManagerPosition
                        key={row.id}
                        row={row}
                        methods={methods}
                        isCorrectionPending={isCorrectionPending}
                        onClearPosition={onClearPosition}
                      />
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                Выберите заявку, чтобы увидеть ее стыки и методы контроля.
              </div>
            )}
          </div>

          <div className="rounded-md border border-rose-200 bg-rose-50/60 p-3">
            <h3 className="mb-1 text-sm font-semibold text-rose-900">Удалить заявку</h3>
            <p className="mb-3 text-xs leading-5 text-rose-800">
              Будут очищены заявка, результат, дата и заключение ЛНК по всем стыкам, где используется выбранная заявка.
            </p>
            <Button
              variant="outline"
              onClick={onDeleteRequest}
              disabled={!requestName || isManagerPending}
              className="border-rose-300 bg-white text-rose-800 hover:bg-rose-50"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Удалить выбранную заявку
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
