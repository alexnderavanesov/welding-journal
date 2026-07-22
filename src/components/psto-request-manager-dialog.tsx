import { LargeDialogShell } from '@/components/large-dialog-shell'
import { PstoRequestManagerPosition } from '@/components/psto-request-manager-position'
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
import { isSystemPstoRequestName } from '@/lib/report-request-naming'
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
  const isSystemRequest = isSystemPstoRequestName(requestName)

  return (
    <LargeDialogShell maxWidthClassName="max-w-[920px]" maxHeightClassName="max-h-[90vh]" overlayClassName="z-[60] bg-slate-950/30">
      <RequestDialogHeader
        title="Управление заявками ПСТО"
        subtitle="Переименование и удаление уже созданных заявок."
        onClose={onClose}
      />

      <div className="min-h-0 space-y-4 overflow-auto px-5 py-4">
        <RequestManagerSelect label="Заявка ПСТО" value={requestName} options={requestOptions} onChange={onChangeRequest} />

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
          disabled={!requestName || isSystemRequest || isManagerPending}
          canRename={Boolean(
            requestName &&
              !isSystemRequest &&
              requestNameDraft.trim() &&
              requestNameDraft.trim() !== requestName &&
              !isManagerPending,
          )}
          onChange={onRequestNameDraftChange}
          onRename={onRenameRequest}
        >
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
            Дата заявки ПСТО фиксируется при создании и не редактируется в управлении заявками. Системную
            заявку переименовать нельзя; пользовательскую можно только переименовать.
          </p>
        </RequestRenamePanel>

        <RequestPositionPanel
          title="Очистить конкретный стык"
          description="Можно удалить заявку только у выбранного стыка, не затрагивая остальные стыки этой заявки."
          hasRows={Boolean(requestName && requestRows.length > 0)}
          emptyText="Выберите заявку, чтобы увидеть ее стыки."
        >
          {requestRows.map((row) => (
            <PstoRequestManagerPosition
              key={row.id}
              row={row}
              isCorrectionPending={isCorrectionPending}
              onClearPosition={onClearPosition}
            />
          ))}
        </RequestPositionPanel>

        <RequestDeletePanel
          description="Будут очищены заявка, результат, дата и диаграмма ПСТО по всем стыкам, где используется выбранная заявка."
          disabled={!requestName || isManagerPending}
          onDelete={onDeleteRequest}
        />
      </div>
    </LargeDialogShell>
  )
}
