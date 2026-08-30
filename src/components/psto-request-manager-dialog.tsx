import { useRef, type MouseEvent } from 'react'
import { Pencil, Trash2 } from 'lucide-react'

import { DialogContextMenuLayer, type DialogContextMenuLayerHandle } from '@/components/dialog-context-menu-layer'
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
import { formatDisplayDate } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getDialogMenuPoint } from '@/lib/dialog-context-menu-items'
import { buildManagerContextMenu, isNativeContextMenuTarget } from '@/lib/manager-context-menu-items'
import { getPstoCycleStageDeleteBlockReason } from '@/lib/psto-cycle-corrections'
import { useRequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { isSystemDocumentNameForRows } from '@/lib/system-document-types'
import {
  createRequestDocumentIdentity,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'

export type PstoRequestManagerDialogProps = {
  requestName: string
  requestDate: string
  requestOptions: RequestDocumentIdentity[]
  requestRows: WeldRow[]
  requestNameDraft: string
  isManagerPending: boolean
  isCorrectionPending: boolean
  canOpenDocument: boolean
  onClose: () => void
  onChangeRequest: (request: RequestDocumentIdentity) => void
  onRequestNameDraftChange: (requestName: string) => void
  onRenameRequest: () => void
  onOpenDocument: (row: WeldRow) => void
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
  onOpenPstoHistory?: (row: WeldRow) => void
  onCopyDocumentName: (documentName: string) => void
  onClearPosition: (row: WeldRow) => void
  onDeleteRequest: (request?: RequestDocumentIdentity) => void
}

export function PstoRequestManagerDialog({
  requestName,
  requestDate,
  requestOptions,
  requestRows,
  requestNameDraft,
  isManagerPending,
  isCorrectionPending,
  canOpenDocument,
  onClose,
  onChangeRequest,
  onRequestNameDraftChange,
  onRenameRequest,
  onOpenDocument,
  onOpenJournalRows,
  onOpenPstoHistory,
  onCopyDocumentName,
  onClearPosition,
  onDeleteRequest,
}: PstoRequestManagerDialogProps) {
  const contextMenuRef = useRef<DialogContextMenuLayerHandle>(null)
  const rowsWithLaterStages = requestRows.filter((row) => (
    getPstoCycleStageDeleteBlockReason(row, 1, 'pstoRequest')
  )).length
  const requestDeleteBlockReason = rowsWithLaterStages > 0
    ? `В ${rowsWithLaterStages} ${formatJointCount(rowsWithLaterStages)} уже есть последующие этапы. Сначала удалите их с конца цепочки в окне «История ПСТО и ТВМТ».`
    : ''
  const requestConclusionSettings = useRequestConclusionSettings()
  const isSystemRequest = isSystemDocumentNameForRows(
    requestRows,
    'pstoRequest',
    requestName,
    requestConclusionSettings,
  )
  const selectedIdentity = createRequestDocumentIdentity(requestName, requestDate)
  const canRename = Boolean(
    requestName &&
    !isSystemRequest &&
    requestNameDraft.trim() &&
    requestNameDraft.trim() !== requestName &&
    !isManagerPending,
  )
  const openRequestContextMenu = (event: MouseEvent<HTMLElement>) => {
    if (!selectedIdentity || isNativeContextMenuTarget(event.target)) return
    const point = getDialogMenuPoint(event)
    const row = requestRows[0]
    const documentReason = !row
      ? 'В заявке нет стыков'
      : !canOpenDocument
        ? 'Сначала загрузите шаблон заявки ПСТО в настройках документов'
        : null

    contextMenuRef.current?.open(buildManagerContextMenu({
      ...point,
      heading: requestName,
      description: requestDate ? `${formatDisplayDate(requestDate)} · ${requestRows.length} ст.` : `${requestRows.length} ст.`,
      documentName: requestName,
      documentLabel: 'заявку',
      rows: requestRows,
      sourceLabel: `заявка ПСТО «${requestName}»`,
      actions: [{
        id: 'rename-request',
        label: 'Переименовать заявку',
        icon: Pencil,
        disabled: !canRename,
        title: isSystemRequest
          ? 'Системную заявку переименовать нельзя'
          : 'Сначала введите новое название в поле переименования',
        onSelect: onRenameRequest,
      }],
      dangerActions: [{
        id: 'delete-request',
        label: 'Удалить заявку',
        icon: Trash2,
        danger: true,
        disabled: isManagerPending || Boolean(requestDeleteBlockReason),
        title: requestDeleteBlockReason || undefined,
        onSelect: () => onDeleteRequest(selectedIdentity),
      }],
      openDocumentDisabledReason: documentReason,
      onOpenDocument: () => {
        if (row) onOpenDocument(row)
      },
      onCopyDocumentName,
      onOpenJournalRows,
      onOpenPstoHistory,
    }))
  }

  return (
    <LargeDialogShell maxWidthClassName="max-w-[920px]" maxHeightClassName="max-h-[90vh]" overlayClassName="z-[60] bg-slate-950/30">
      <RequestDialogHeader
        title="Управление заявками ПСТО"
        subtitle="Переименование и удаление уже созданных заявок."
        onClose={onClose}
      />

      <div
        className="min-h-0 space-y-4 overflow-auto px-5 py-4"
        onContextMenu={openRequestContextMenu}
      >
        <RequestManagerSelect
          label="Заявка ПСТО"
          value={selectedIdentity?.key ?? ''}
          options={requestOptions}
          onChange={onChangeRequest}
        />

        {requestName ? (
          <RequestManagerUsagePanel>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-slate-800">Используется:</span>
              <RequestManagerUsageBadge>Стыков: {requestRows.length}</RequestManagerUsageBadge>
              <RequestManagerUsageBadge>С последующими этапами: {rowsWithLaterStages}</RequestManagerUsageBadge>
            </div>
          </RequestManagerUsagePanel>
        ) : (
          <RequestManagerEmptyState>Созданных заявок ПСТО пока нет.</RequestManagerEmptyState>
        )}

        <RequestRenamePanel
          value={requestNameDraft}
          placeholder="Новое наименование заявки"
          disabled={!requestName || isSystemRequest || isManagerPending}
          canRename={canRename}
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
          description={requestDeleteBlockReason || 'Будут очищены только заявка ПСТО и ее дата по всем стыкам выбранной заявки.'}
          disabled={!requestName || isManagerPending || Boolean(requestDeleteBlockReason)}
          onDelete={() => onDeleteRequest(selectedIdentity ?? undefined)}
        />
      </div>
      <DialogContextMenuLayer ref={contextMenuRef} />
    </LargeDialogShell>
  )
}

function formatJointCount(count: number) {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'стыках'
  if (mod10 === 1) return 'стыке'
  return 'стыках'
}
