import { X } from 'lucide-react'

import { PstoRequestManagerPosition } from '@/components/psto-request-manager-position'
import {
  RequestDeletePanel,
  RequestManagerEmptyState,
  RequestManagerSelect,
  RequestManagerUsageBadge,
  RequestManagerUsagePanel,
  RequestRenamePanel,
} from '@/components/request-manager-panels'
import { Button } from '@/components/ui/button'
import type { WeldRow } from '@/lib/dispatcher-types'
import { hasText } from '@/lib/report-value-utils'

export type PstoRequestManagerDialogProps = {
  requestName: string
  requestOptions: string[]
  requestRows: WeldRow[]
  requestNameDraft: string
  isManagerPending: boolean
  isCorrectionPending: boolean
  onClose: () => void
  onChangeRequest: (requestName: string) => void
  onRequestNameDraftChange: (requestName: string) => void
  onRenameRequest: () => void
  onClearPosition: (row: WeldRow) => void
  onDeleteRequest: () => void
}

export function PstoRequestManagerDialog({
  requestName,
  requestOptions,
  requestRows,
  requestNameDraft,
  isManagerPending,
  isCorrectionPending,
  onClose,
  onChangeRequest,
  onRequestNameDraftChange,
  onRenameRequest,
  onClearPosition,
  onDeleteRequest,
}: PstoRequestManagerDialogProps) {
  const resultCount = requestRows.filter((row) => hasText(row.pstoResult)).length

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-[1px]">
      <div className="flex max-h-[90vh] w-full max-w-[920px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Управление заявками ПСТО</h2>
            <p className="text-sm text-muted-foreground">Переименование и удаление уже созданных заявок.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 space-y-4 overflow-auto px-5 py-4">
          <RequestManagerSelect
            label="Заявка ПСТО"
            value={requestName}
            options={requestOptions}
            onChange={onChangeRequest}
          />

          {requestName ? (
            <RequestManagerUsagePanel>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-slate-800">Используется:</span>
                <RequestManagerUsageBadge>Стыков: {requestRows.length}</RequestManagerUsageBadge>
                <RequestManagerUsageBadge>С результатом: {resultCount}</RequestManagerUsageBadge>
              </div>
            </RequestManagerUsagePanel>
          ) : (
            <RequestManagerEmptyState>Созданных заявок ПСТО пока нет.</RequestManagerEmptyState>
          )}

          <RequestRenamePanel
            value={requestNameDraft}
            placeholder="Новое наименование заявки"
            disabled={!requestName || isManagerPending}
            canRename={Boolean(requestName && requestNameDraft.trim() && requestNameDraft.trim() !== requestName && !isManagerPending)}
            onChange={onRequestNameDraftChange}
            onRename={onRenameRequest}
          />

          <div className="rounded-md border border-slate-200 bg-white p-3">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-slate-800">Очистить конкретный стык</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Можно удалить заявку только у выбранного стыка, не затрагивая остальные стыки этой заявки.
              </p>
            </div>
            {requestName && requestRows.length > 0 ? (
              <div className="max-h-72 overflow-auto rounded-md border border-slate-200">
                <div className="divide-y divide-slate-100">
                  {requestRows.map((row) => (
                    <PstoRequestManagerPosition
                      key={row.id}
                      row={row}
                      isCorrectionPending={isCorrectionPending}
                      onClearPosition={onClearPosition}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                Выберите заявку, чтобы увидеть ее стыки.
              </div>
            )}
          </div>

          <RequestDeletePanel
            description="Будут очищены заявка, результат, дата и диаграмма ПСТО по всем стыкам, где используется выбранная заявка."
            disabled={!requestName || isManagerPending}
            onDelete={onDeleteRequest}
          />
        </div>
      </div>
    </div>
  )
}
