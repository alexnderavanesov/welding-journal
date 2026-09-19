import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  CalendarClock,
  ArrowLeftRight,
  FileSpreadsheet,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'

import { DialogContextMenuLayer, type DialogContextMenuLayerHandle } from '@/components/dialog-context-menu-layer'
import { DialogVirtualizedRows } from '@/components/dialog-virtualized-rows'
import { LnkControlStageSwitch } from '@/components/lnk-control-stage-switch'
import { LnkRequestManagerPosition } from '@/components/lnk-request-manager-position'
import { BufferedFilterInput } from '@/components/result-filters'
import { WorkflowDialogShell } from '@/components/workflow-dialog-shell'
import { SystemDocumentDateEditor } from '@/components/system-document-date-editor'
import { RequestDialogHeader } from '@/components/request-dialog-header'
import {
  RequestDeletePanel,
  RequestManagerEmptyState,
  RequestPositionPanel,
  RequestRenamePanel,
} from '@/components/request-manager-panels'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { formatDisplayDate } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { LnkRequestExtensionOption } from '@/lib/lnk-request-extension'
import { LNK_METHODS } from '@/lib/report-config'
import { hasCompletedLnkRequestPosition } from '@/lib/report-control-state'
import { getLnkRowRequestMethods } from '@/lib/report-modal-rows'
import { useRequestConclusionSettings } from '@/lib/request-conclusion-settings'
import {
  getSystemDocumentReferenceForField,
  isSystemDocumentNameForRows,
  type SystemDocumentReference,
} from '@/lib/system-document-types'
import { getDialogMenuPoint } from '@/lib/dialog-context-menu-items'
import { buildManagerContextMenu } from '@/lib/manager-context-menu-items'
import {
  createRequestDocumentIdentity,
  isSameRequestDocument,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'
import type {
  WorkflowRootCauseAction,
  WorkflowRootCauseTarget,
} from '@/lib/workflow-root-cause-actions'

type LnkRequestMethod = (typeof LNK_METHODS)[number]
type RegistryFilter = 'all' | 'open' | 'fixed'

export type LnkRequestManagerDialogProps = {
  embedded?: boolean
  elevated?: boolean
  requestName: string
  requestDate: string
  requestOptions: LnkRequestExtensionOption[]
  allRows: WeldRow[]
  requestRows: WeldRow[]
  requestMethods: LnkRequestMethod[]
  requestNameDraft: string
  isManagerPending: boolean
  isCorrectionPending: boolean
  canOpenDocument: (fieldKey: LnkRequestMethod['requestKey']) => boolean
  onClose: () => void
  onStageChange?: () => void
  onChangeRequest: (request: RequestDocumentIdentity) => void
  onCreateRequest: () => void
  onAddPositions: (request: LnkRequestExtensionOption) => void
  onOpenRows: () => void
  onOpenDocument: (row: WeldRow, fieldKey: LnkRequestMethod['requestKey']) => void
  onChangeControlStage?: (reference: SystemDocumentReference & { documentId: number }) => void
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
  onOpenPstoHistory?: (row: WeldRow) => void
  onCopyDocumentName: (documentName: string) => void
  onRequestNameDraftChange: (requestName: string) => void
  onRenameRequest: () => void
  onClearPosition: (row: WeldRow, requestKey: LnkRequestMethod['requestKey']) => void
  onDeleteRequest: (request?: RequestDocumentIdentity) => void
  rootCauseTarget?: Extract<WorkflowRootCauseTarget, { kind: 'lnk-control' }>
  onRunRootCauseAction?: (action: WorkflowRootCauseAction) => void
  onDocumentDateSaved?: () => void
  onMessage?: (message: string) => void
}

export function LnkRequestManagerDialog({
  embedded = false,
  elevated = false,
  requestName,
  requestDate,
  requestOptions,
  allRows,
  requestRows,
  requestMethods,
  requestNameDraft,
  isManagerPending,
  isCorrectionPending,
  canOpenDocument,
  onClose,
  onStageChange,
  onChangeRequest,
  onCreateRequest,
  onAddPositions,
  onOpenRows,
  onOpenDocument,
  onChangeControlStage,
  onOpenJournalRows,
  onOpenPstoHistory,
  onCopyDocumentName,
  onRequestNameDraftChange,
  onRenameRequest,
  onClearPosition,
  onDeleteRequest,
  rootCauseTarget,
  onRunRootCauseAction,
  onDocumentDateSaved,
  onMessage,
}: LnkRequestManagerDialogProps) {
  const contextMenuRef = useRef<DialogContextMenuLayerHandle>(null)
  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState('')
  const [filter, setFilter] = useState<RegistryFilter>('all')
  const [showRequestSettings, setShowRequestSettings] = useState(false)
  const requestConclusionSettings = useRequestConclusionSettings()
  const stableOnClearPosition = useStableEventCallback(onClearPosition)
  const selectedIdentity = useMemo(
    () => createRequestDocumentIdentity(requestName, requestDate),
    [requestDate, requestName],
  )
  const selectedOption = useMemo(
    () => selectedIdentity
      ? requestOptions.find((request) => request.key === selectedIdentity.key)
      : undefined,
    [requestOptions, selectedIdentity],
  )
  const isSystemRequest = useMemo(
    () => isSystemDocumentNameForRows(
      requestRows,
      'lnkRequest',
      requestName,
      requestConclusionSettings,
    ),
    [requestConclusionSettings, requestName, requestRows],
  )
  const requestPositionEntries = useMemo(
    () => requestRows.map((row) => ({
      row,
      methods: getLnkRowRequestMethods(row, requestName, requestDate),
    })),
    [requestDate, requestName, requestRows],
  )
  const positionCount = useMemo(
    () => requestPositionEntries.reduce((count, entry) => count + entry.methods.length, 0),
    [requestPositionEntries],
  )
  const completedPosition = useMemo(
    () => requestPositionEntries.flatMap(({ row, methods }) =>
      methods
        .filter((method) => hasCompletedLnkRequestPosition(row, method))
        .map((method) => ({ row, method })),
    )[0],
    [requestPositionEntries],
  )
  const deleteBlockReason = completedPosition
    ? `Удаление недоступно: по стыку ${String(completedPosition.row.joint ?? '').trim() || `№${completedPosition.row.id}`}, ${completedPosition.method.code} уже внесен результат или заключение.`
    : null
  const filteredOptions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru')
    return requestOptions.filter((request) => {
      if (methodFilter && !request.methodCodes.includes(methodFilter)) return false
      if (filter === 'open' && request.disabledReason) return false
      if (filter === 'fixed' && !request.disabledReason) return false
      if (!query) return true
      return `${request.label} ${request.methodCodes.join(' ')} ${request.searchText}`
        .toLocaleLowerCase('ru')
        .includes(query)
    })
  }, [filter, methodFilter, requestOptions, search])
  const getRequestContext = useCallback((request: RequestDocumentIdentity) => {
    const rows = allRows.filter((row) =>
      LNK_METHODS.some((method) =>
        isSameRequestDocument(row[method.requestKey], row[method.requestDateKey], request),
      ),
    )
    const method = LNK_METHODS.find((candidate) =>
      rows.some((row) => isSameRequestDocument(row[candidate.requestKey], row[candidate.requestDateKey], request)),
    )
    const row = method
      ? rows.find((candidate) => isSameRequestDocument(candidate[method.requestKey], candidate[method.requestDateKey], request))
      : undefined
    return { rows, row, method }
  }, [allRows])
  const openRequestContextMenu = (event: MouseEvent<HTMLElement>, request: LnkRequestExtensionOption) => {
    const point = getDialogMenuPoint(event)
    const context = getRequestContext(request)
    const systemRequest = isSystemDocumentNameForRows(
      context.rows,
      'lnkRequest',
      request.name,
      requestConclusionSettings,
    )
    const completed = context.rows.flatMap((row) =>
      LNK_METHODS.flatMap((method) =>
        isSameRequestDocument(row[method.requestKey], row[method.requestDateKey], request) &&
        hasCompletedLnkRequestPosition(row, method)
          ? [{ row, method }]
          : [],
      ),
    )[0]
    const deleteReason = completed
      ? `Удаление недоступно: по стыку ${String(completed.row.joint ?? '').trim() || `№${completed.row.id}`}, ${completed.method.code} уже внесен результат или заключение.`
      : null
    const documentReason = !context.row || !context.method
      ? 'В заявке нет позиций'
      : !canOpenDocument(context.method.requestKey)
        ? 'Для этого вида контроля нет доступного шаблона заявки'
        : null
    const transferReference = context.row && context.method
      ? getSystemDocumentReferenceForField(context.row, context.method.requestKey)
      : null

    onChangeRequest(request)
    contextMenuRef.current?.open(buildManagerContextMenu({
      ...point,
      heading: request.name,
      description: request.date ? `${formatDisplayDate(request.date)} · ${context.rows.length} ст.` : `${context.rows.length} ст.`,
      documentName: request.name,
      documentLabel: 'заявку',
      rows: context.rows,
      sourceLabel: `заявка ЛНК «${request.name}»`,
      actions: [
        {
          id: 'add-positions',
          label: 'Добавить позиции',
          icon: Plus,
          disabled: Boolean(request.disabledReason) || isManagerPending || isCorrectionPending,
          title: request.disabledReason ?? undefined,
          onSelect: () => onAddPositions(request),
        },
        {
          id: 'change-request-date',
          label: 'Изменить дату заявки',
          icon: CalendarClock,
          disabled: !context.row || !context.method || isManagerPending || isCorrectionPending,
          onSelect: () => {
            onChangeRequest(request)
            setShowRequestSettings(true)
          },
        },
        {
          id: 'rename-request',
          label: 'Переименовать заявку',
          icon: Pencil,
          disabled: systemRequest || isManagerPending,
          title: systemRequest ? 'Системную заявку переименовать нельзя' : undefined,
          onSelect: () => {
            onChangeRequest(request)
            setShowRequestSettings(true)
          },
        },
        ...(onChangeControlStage ? [{
          id: 'change-control-stage',
          label: 'Изменить этап контроля',
          icon: ArrowLeftRight,
          disabled: !transferReference?.documentId || isManagerPending || isCorrectionPending,
          onSelect: () => {
            if (transferReference?.documentId) {
              onChangeControlStage({
                ...transferReference,
                documentId: transferReference.documentId,
              })
            }
          },
        }] : []),
      ],
      dangerActions: [{
        id: 'delete-request',
        label: 'Удалить заявку',
        icon: Trash2,
        danger: true,
        disabled: isManagerPending || Boolean(deleteReason),
        title: deleteReason ?? undefined,
        onSelect: () => onDeleteRequest(request),
      }],
      openDocumentDisabledReason: documentReason,
      onOpenDocument: () => {
        if (context.row && context.method) onOpenDocument(context.row, context.method.requestKey)
      },
      onCopyDocumentName,
      onOpenJournalRows,
      onOpenPstoHistory,
    }))
  }

  const selectedRequestContext = useMemo(
    () => selectedIdentity ? getRequestContext(selectedIdentity) : undefined,
    [getRequestContext, selectedIdentity],
  )
  const selectedDocumentMethod = selectedRequestContext?.method
  const selectedDocumentReference = useMemo(
    () => selectedRequestContext?.row && selectedDocumentMethod
      ? getSystemDocumentReferenceForField(selectedRequestContext.row, selectedDocumentMethod.requestKey)
      : null,
    [selectedDocumentMethod, selectedRequestContext?.row],
  )
  const canOpenSelectedDocument = Boolean(
    selectedDocumentMethod && canOpenDocument(selectedDocumentMethod.requestKey),
  )

  useEffect(() => {
    if (
      rootCauseTarget?.stage === 'primary' &&
      rootCauseTarget.documentPart === 'request' &&
      rootCauseTarget.focus === 'date'
    ) {
      setShowRequestSettings(true)
    }
  }, [rootCauseTarget])

  const content = (
    <>
      <RequestDialogHeader
        title="Редактирование заявок ЛНК"
        subtitle="Найдите заявку, проверьте ее состав или выполните доступное действие."
        onClose={onClose}
        actions={onStageChange ? <LnkControlStageSwitch value="primary" onChange={(stage) => {
          if (stage === 'beforeHeatTreatment') onStageChange()
        }} /> : null}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-slate-200 bg-slate-50/70 lg:border-b-0 lg:border-r">
          <div className="space-y-3 border-b border-slate-200 p-4">
            <Button className="w-full" onClick={onCreateRequest} disabled={isManagerPending || isCorrectionPending}>
              <Plus className="mr-2 h-4 w-4" />
              Новая заявка
            </Button>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <BufferedFilterInput
                value={search}
                onValueChange={setSearch}
                placeholder="Название, дата, стык или линия"
                className="h-10 bg-white pl-9"
              />
            </label>
            <Select
              aria-label="Вид контроля в реестре"
              value={methodFilter}
              onChange={(event) => setMethodFilter(event.target.value)}
            >
              <option value="">Все виды контроля</option>
              {LNK_METHODS.map((method) => (
                <option key={method.code} value={method.code}>{method.code}</option>
              ))}
            </Select>
            <div className="grid grid-cols-3 rounded-md border border-slate-200 bg-white p-1 text-xs" role="group" aria-label="Фильтр заявок">
              {([
                ['all', 'Все'],
                ['open', 'Открытые'],
                ['fixed', 'Закрытые'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className={`min-h-8 rounded px-2 font-medium transition ${
                    filter === value ? 'bg-sky-50 text-sky-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Найдено: {filteredOptions.length}</span>
              <span>Всего: {requestOptions.length}</span>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col p-2 lg:max-h-none">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-slate-500">
                {requestOptions.length === 0 ? 'Заявок ЛНК пока нет.' : 'По заданным условиям заявки не найдены.'}
              </div>
            ) : (
              <DialogVirtualizedRows
                items={filteredOptions}
                estimateRowHeight={92}
                getItemKey={(request) => request.key}
                renderItem={(request) => {
                  const selected = request.key === selectedIdentity?.key
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        setShowRequestSettings(false)
                        onChangeRequest(request)
                      }}
                      onContextMenu={(event) => openRequestContextMenu(event, request)}
                      className={`mb-1 w-full rounded-md border px-3 py-3 text-left transition ${
                        selected
                          ? 'border-sky-300 bg-white shadow-sm ring-1 ring-sky-100'
                          : 'border-transparent hover:border-slate-200 hover:bg-white'
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-900">{request.name}</span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {request.date ? formatDisplayDate(request.date) : 'Дата не указана'}
                          </span>
                        </span>
                        <RequestStatusBadge isFixed={Boolean(request.disabledReason)} compact />
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>{request.rowCount} ст.</span>
                        <span>{request.positionCount} поз.</span>
                        <span>{request.methodCodes.join(', ') || 'НК не указан'}</span>
                      </span>
                    </button>
                  )
                }}
                footer={null}
              />
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto bg-white">
          {!selectedIdentity ? (
            <div className="flex min-h-[420px] items-center justify-center p-8">
              <RequestManagerEmptyState>Выберите заявку слева, чтобы открыть ее карточку.</RequestManagerEmptyState>
            </div>
          ) : (
            <div className="space-y-5 p-5 lg:p-6">
              <section className="border-b border-slate-200 pb-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <RequestStatusBadge isFixed={selectedOption ? Boolean(selectedOption.disabledReason) : null} />
                      <span className="text-xs font-medium text-slate-500">
                        {requestDate ? formatDisplayDate(requestDate) : 'Дата не указана'}
                      </span>
                    </div>
                    <h2 className="break-words text-xl font-semibold text-slate-950">{requestName}</h2>
                    <p className="mt-1 text-sm leading-5 text-slate-500">
                      {selectedOption?.disabledReason ?? (
                        selectedOption
                          ? 'Заявку можно дополнить новыми позициями до появления результата или заключения.'
                          : 'Загружаем актуальный состав и состояние заявки...'
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={() => selectedOption && onAddPositions(selectedOption)}
                      disabled={!selectedOption || Boolean(selectedOption.disabledReason) || isManagerPending || isCorrectionPending}
                      title={selectedOption?.disabledReason ?? undefined}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Добавить позиции
                    </Button>
                    <Button variant="outline" onClick={onOpenRows} disabled={requestRows.length === 0}>
                      <ListFilter className="mr-2 h-4 w-4" />
                      Показать в ЛНК
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (!selectedIdentity) return
                        const context = getRequestContext(selectedIdentity)
                        if (context.row && context.method) onOpenDocument(context.row, context.method.requestKey)
                      }}
                      disabled={!canOpenSelectedDocument || requestRows.length === 0}
                      title={!canOpenSelectedDocument ? 'Для этого вида контроля нет доступного шаблона заявки' : undefined}
                    >
                      <FileSpreadsheet className="mr-2 h-4 w-4" />
                      Открыть документ
                    </Button>
                    {onChangeControlStage ? (
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (selectedDocumentReference?.documentId) {
                            onChangeControlStage({
                              ...selectedDocumentReference,
                              documentId: selectedDocumentReference.documentId,
                            })
                          }
                        }}
                        disabled={!selectedDocumentReference?.documentId || isManagerPending || isCorrectionPending}
                      >
                        <ArrowLeftRight className="mr-2 h-4 w-4" />
                        Изменить этап
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Дополнительные действия с заявкой"
                      title="Дополнительные действия"
                      onClick={() => setShowRequestSettings((current) => !current)}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-3">
                  <RequestMetric label="Стыков" value={requestRows.length} />
                  <RequestMetric label="Позиций НК" value={positionCount} />
                  <RequestMetric label="Видов контроля" value={requestMethods.length} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {requestMethods.map((method) => (
                    <span
                      key={method.requestKey}
                      className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800"
                    >
                      {method.code}:{' '}
                      {requestRows.filter((row) =>
                        isSameRequestDocument(row[method.requestKey], row[method.requestDateKey], {
                          name: requestName,
                          date: requestDate,
                        }),
                      ).length}
                    </span>
                  ))}
                </div>
              </section>

              {showRequestSettings ? (
                <section className="space-y-3 rounded-md border border-slate-200 bg-slate-50/70 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Дополнительные действия</h3>
                    <p className="mt-1 text-xs text-slate-500">Переименование и удаление не меняют правила проверки заявки.</p>
                  </div>
                  {selectedDocumentReference ? (
                    <SystemDocumentDateEditor
                      reference={selectedDocumentReference}
                      label="Дата заявки ЛНК"
                      disabled={isManagerPending || isCorrectionPending}
                      autoFocus={rootCauseTarget?.focus === 'date'}
                      onMessage={onMessage}
                      onRunRootCauseAction={onRunRootCauseAction}
                      onSaved={(result) => {
                        const nextIdentity = createRequestDocumentIdentity(result.nextTitle, result.nextDate)
                        if (nextIdentity) onChangeRequest(nextIdentity)
                        onDocumentDateSaved?.()
                      }}
                    />
                  ) : null}
                  <RequestRenamePanel
                    value={requestNameDraft}
                    placeholder="Новое наименование заявки"
                    disabled={!requestName || isSystemRequest || isManagerPending}
                    canRename={Boolean(
                      requestName &&
                        !isSystemRequest &&
                        requestNameDraft.trim() &&
                        !isManagerPending &&
                        requestNameDraft.trim() !== requestName
                    )}
                    onChange={onRequestNameDraftChange}
                    onRename={onRenameRequest}
                  >
                    <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                      Изменение даты применяется ко всем позициям заявки. Системное имя пересчитывается с тем же номером; пользовательское имя сохраняется.
                    </p>
                  </RequestRenamePanel>
                  <RequestDeletePanel
                    description={deleteBlockReason ?? 'Все ожидающие позиции будут исключены из этой заявки. Назначения видов НК сохранятся, выполненные контроли таким действием удалить нельзя.'}
                    disabled={!requestName || isManagerPending || Boolean(deleteBlockReason)}
                    onDelete={() => onDeleteRequest(selectedIdentity ?? undefined)}
                  />
                </section>
              ) : null}

              <RequestPositionPanel
                title="Состав заявки"
                description="Кнопка вида НК исключает только эту позицию стыка. Другие виды НК и остальные стыки заявки не меняются; выполненный контроль исключить нельзя."
                hasRows={Boolean(requestName && requestRows.length > 0)}
                emptyText="В заявке больше нет позиций."
                virtualized
              >
                <DialogVirtualizedRows
                  items={requestPositionEntries}
                  estimateRowHeight={66}
                  getItemKey={({ row }) => row.id}
                  renderItem={({ row, methods }) => (
                    <LnkRequestManagerPosition
                      row={row}
                      methods={methods}
                      isCorrectionPending={isCorrectionPending}
                      onClearPosition={stableOnClearPosition}
                    />
                  )}
                  footer={null}
                />
              </RequestPositionPanel>
            </div>
          )}
        </main>
      </div>

      <DialogContextMenuLayer ref={contextMenuRef} />
    </>
  )

  return embedded ? content : <WorkflowDialogShell variant="manager" elevated={elevated}>{content}</WorkflowDialogShell>
}

function RequestStatusBadge({ isFixed, compact = false }: { isFixed: boolean | null; compact?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border font-medium ${
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
      } ${
        isFixed === null
          ? 'border-slate-200 bg-white text-slate-500'
          : isFixed
          ? 'border-slate-200 bg-slate-100 text-slate-600'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
      }`}
    >
      {isFixed === null ? <LoaderCircle className="mr-1 h-3 w-3 animate-spin" /> : null}
      {isFixed ? <LockKeyhole className="mr-1 h-3 w-3" /> : null}
      {isFixed === null ? 'Загрузка' : isFixed ? 'Закрыта' : 'Открыта'}
    </span>
  )
}

function RequestMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-h-14 items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <strong className="text-base font-semibold text-slate-900">{value}</strong>
    </div>
  )
}
