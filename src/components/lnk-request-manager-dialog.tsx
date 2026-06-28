import { LnkRequestManagerPosition } from '@/components/lnk-request-manager-position'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { RequestDialogHeader } from '@/components/request-dialog-header'
import {
  RequestDeletePanel,
  RequestManagerEmptyState,
  RequestManagerSelect,
  RequestManagerUsageBadge,
  RequestManagerUsagePanel,
  RequestPositionPanel,
  RequestRenamePanel,
} from '@/components/request-manager-panels'
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
    <LargeDialogShell maxWidthClassName="max-w-[920px]" maxHeightClassName="max-h-[90vh]" overlayClassName="z-[60] bg-slate-950/30">
      <RequestDialogHeader
        title="Управление заявками ЛНК"
        subtitle="Переименование и удаление уже созданных заявок."
        onClose={onClose}
      />

      <div className="min-h-0 space-y-4 overflow-auto px-5 py-4">
        <RequestManagerSelect label="Заявка ЛНК" value={requestName} options={requestOptions} onChange={onChangeRequest} />

        {requestName ? (
          <RequestManagerUsagePanel>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-slate-800">Используется:</span>
              <RequestManagerUsageBadge>Стыков: {requestRows.length}</RequestManagerUsageBadge>
              <RequestManagerUsageBadge>Позиций: {positionCount}</RequestManagerUsageBadge>
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
          </RequestManagerUsagePanel>
        ) : (
          <RequestManagerEmptyState>Созданных заявок ЛНК пока нет.</RequestManagerEmptyState>
        )}

        <RequestRenamePanel
          value={requestNameDraft}
          placeholder="Новое наименование заявки"
          disabled={!requestName || isManagerPending}
          canRename={Boolean(requestName && requestNameDraft.trim() && requestNameDraft.trim() !== requestName && !isManagerPending)}
          onChange={onRequestNameDraftChange}
          onRename={onRenameRequest}
        />

        <RequestPositionPanel
          title="Очистить конкретную позицию"
          description="Можно удалить заявку только у выбранного стыка и метода контроля, не затрагивая остальные позиции заявки."
          hasRows={Boolean(requestName && requestRows.length > 0)}
          emptyText="Выберите заявку, чтобы увидеть ее стыки и методы контроля."
        >
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
        </RequestPositionPanel>

        <RequestDeletePanel
          description="Будут очищены заявка, результат, дата и заключение ЛНК по всем стыкам, где используется выбранная заявка."
          disabled={!requestName || isManagerPending}
          onDelete={onDeleteRequest}
        />
      </div>
    </LargeDialogShell>
  )
}
