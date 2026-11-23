import { PSTO_REQUEST_DOCUMENTS } from '@/lib/workflow-document-choices'
import { WorkflowManagerViews, WorkflowDocumentLink, useWorkflowManagerView } from './workflow-manager-views'
import { ManagerEditPanel, ManagerEditSection } from './manager-edit-panel'
import { DocumentConnectionsButton } from './document-connections-button'
import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { Pencil, Search } from 'lucide-react'

import { DialogContextMenuLayer, type DialogContextMenuLayerHandle } from '@/components/dialog-context-menu-layer'
import { WorkflowDialogShell } from '@/components/workflow-dialog-shell'
import { PstoRequestManagerPosition } from '@/components/psto-request-manager-position'
import { BufferedFilterInput } from '@/components/result-filters'
import { RequestDialogHeader } from '@/components/request-dialog-header'
import {
  RequestDeletePanel,
  RequestManagerEmptyState,
  RequestManagerSelect,
  RequestManagerUsageBadge,
  RequestManagerUsagePanel,
  RequestPositionPanel,
} from '@/components/request-manager-panels'
import { formatDisplayDate } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getDialogMenuPoint } from '@/lib/dialog-context-menu-items'
import { buildManagerContextMenu, isNativeContextMenuTarget } from '@/lib/manager-context-menu-items'
import { getPstoCycleStageDeleteBlockReason } from '@/lib/psto-cycle-corrections'
import {
  getSystemDocumentReferenceForField,
} from '@/lib/system-document-types'
import { buildPrimaryPstoSystemDocumentRow } from '@/lib/system-document-virtual-row'
import {
  createRequestDocumentIdentity,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'
import type {
  WorkflowRootCauseAction,
  WorkflowRootCauseTarget,
} from '@/lib/workflow-root-cause-actions'

export type PstoRequestManagerDialogProps = {
  elevated?: boolean
  requestName: string
  requestDate: string
  requestOptions: RequestDocumentIdentity[]
  requestOptionsHasMore?: boolean
  requestSearch?: string
  requestRows: WeldRow[]
  isManagerPending: boolean
  isCorrectionPending: boolean
  canOpenDocument: boolean
  onClose: () => void
  onChangeRequest: (request: RequestDocumentIdentity) => void
  onRequestSearchChange?: (value: string) => void
  onOpenDocument: (row: WeldRow) => void
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
  onOpenPstoHistory?: (row: WeldRow) => void
  onCopyDocumentName: (documentName: string) => void
  onClearPosition: (row: WeldRow) => void
  onDeleteRequest: (request?: RequestDocumentIdentity) => void
  rootCauseTarget?: Extract<WorkflowRootCauseTarget, { kind: 'psto-cycle' }>
  onRunRootCauseAction?: (action: WorkflowRootCauseAction) => void
  onDocumentDateSaved?: () => void
  onMessage?: (message: string) => void
}

export function PstoRequestManagerDialog({
  elevated = false,
  requestName,
  requestDate,
  requestOptions,
  requestOptionsHasMore = false,
  requestSearch = '',
  requestRows,
  isManagerPending,
  isCorrectionPending,
  canOpenDocument,
  onClose,
  onChangeRequest,
  onRequestSearchChange,
  onOpenDocument,
  onOpenJournalRows,
  onOpenPstoHistory,
  onCopyDocumentName,
  onClearPosition,
  onDeleteRequest,
  rootCauseTarget,
  onRunRootCauseAction,
  onDocumentDateSaved,
  onMessage,
}: PstoRequestManagerDialogProps) {
  const managerView = useWorkflowManagerView()
  const contextMenuRef = useRef<DialogContextMenuLayerHandle>(null)
  const [dateEditorFocusKey, setDateEditorFocusKey] = useState(0)
  const rowsWithLaterStages = requestRows.filter((row) => (
    getPstoCycleStageDeleteBlockReason(row, 1, 'pstoRequest')
  )).length
  const requestDeleteBlockReason = rowsWithLaterStages > 0
    ? `В ${rowsWithLaterStages} ${formatJointCount(rowsWithLaterStages)} уже есть последующие этапы. Сначала удалите их с конца цепочки в окне «История ПСТО и ТВМТ».`
    : ''
  const selectedIdentity = createRequestDocumentIdentity(requestName, requestDate)
  const documentReference = useMemo(
    () => requestRows[0]
      ? getSystemDocumentReferenceForField(buildPrimaryPstoSystemDocumentRow(requestRows[0]), 'pstoRequest')
      : null,
    [requestRows],
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
        id: 'edit-request', label: 'Внести изменения', icon: Pencil,
        disabled: isManagerPending || isCorrectionPending,
        onSelect: () => setDateEditorFocusKey(current => current + 1),
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
    <WorkflowDialogShell variant="manager" elevated={elevated}>
      <RequestDialogHeader
        title="Все заявки ПСТО"
        subtitle="Найдите заявку, проверьте ее состав или выполните доступное действие."
        onClose={onClose}
      />

      <WorkflowManagerViews view={managerView} documents={{ choices: PSTO_REQUEST_DOCUMENTS, disabled: isManagerPending || isCorrectionPending, onSaved: reference => { const identity = createRequestDocumentIdentity(reference.title, reference.date); if (identity) onChangeRequest(identity); onDocumentDateSaved?.() }, onMessage, onRunRootCauseAction, onOpenJournalRows }}>
      <div
        className="min-h-0 space-y-4 overflow-auto px-5 py-4"
        onContextMenu={openRequestContextMenu}
      >
        <div className="space-y-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <BufferedFilterInput
              value={requestSearch}
              onValueChange={(value) => onRequestSearchChange?.(value)}
              placeholder="Название, дата, стык или линия"
              className="h-10 bg-white pl-9"
            />
          </label>
          <RequestManagerSelect
            label="Заявка ПСТО"
            value={selectedIdentity?.key ?? ''}
            options={requestOptions}
            onChange={(request) => { setDateEditorFocusKey(0); onChangeRequest(request) }}
          />
          {requestOptionsHasMore ? (
            <p className="text-xs text-amber-700">
              Показаны первые 200 заявок. Уточните поиск, чтобы найти остальные.
            </p>
          ) : null}
        </div>

        {requestName ? (
          <RequestManagerUsagePanel>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-slate-800">Используется:</span>
              <RequestManagerUsageBadge>Стыков: {requestRows.length}</RequestManagerUsageBadge>
              <RequestManagerUsageBadge>С последующими этапами: {rowsWithLaterStages}</RequestManagerUsageBadge>
              <DocumentConnectionsButton reference={documentReference} />
            </div>
          </RequestManagerUsagePanel>
        ) : (
          <RequestManagerEmptyState>Созданных заявок ПСТО пока нет.</RequestManagerEmptyState>
        )}

        {requestName ? <ManagerEditPanel key={selectedIdentity?.key} title="Заявка и её состав"
          requestToken={dateEditorFocusKey || (rootCauseTarget?.stage === 'pstoRequest' && rootCauseTarget.sequence === 1 &&
            requestRows.some(row => row.id === rootCauseTarget.rowId) ? rootCauseTarget.focus : undefined)}
          summary={(editing) => !editing ? <RequestPositionPanel title="Состав заявки" description="Для изменения заявки или её состава нажмите «Редактировать»."
            hasRows={requestRows.length > 0} emptyText="В заявке нет стыков.">
            {requestRows.map(row => <PstoRequestManagerPosition key={row.id} row={row} readOnly
              isCorrectionPending={isCorrectionPending} onClearPosition={onClearPosition} />)}
          </RequestPositionPanel> : null}>
        {documentReference ? <WorkflowDocumentLink reference={documentReference} onOpen={managerView.openDocument} focusDate={rootCauseTarget?.focus === 'date'} /> : null}
        <ManagerEditSection title="Удаление всей заявки" description="Это действие относится ко всей заявке; отдельные позиции редактируются ниже.">
        <RequestDeletePanel
          description={requestDeleteBlockReason || 'Будут очищены только заявка ПСТО и ее дата по всем стыкам выбранной заявки.'}
          disabled={!requestName || isManagerPending || Boolean(requestDeleteBlockReason)}
          onDelete={() => onDeleteRequest(selectedIdentity ?? undefined)}
        />
        </ManagerEditSection>
        <ManagerEditSection title="Редактирование состава заявки" description="Исключается только выбранный стык. Остальные стыки заявки сохраняются.">
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

        </ManagerEditSection>
        </ManagerEditPanel> : null}

      </div>
      </WorkflowManagerViews>
      <DialogContextMenuLayer ref={contextMenuRef} />
    </WorkflowDialogShell>
  )
}

function formatJointCount(count: number) {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'стыках'
  if (mod10 === 1) return 'стыке'
  return 'стыках'
}
