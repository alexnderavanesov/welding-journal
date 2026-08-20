import { useMemo, useState } from 'react'
import {
  FileSpreadsheet,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  Search,
} from 'lucide-react'

import { LnkRequestManagerPosition } from '@/components/lnk-request-manager-position'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { RequestDialogHeader } from '@/components/request-dialog-header'
import {
  RequestDeletePanel,
  RequestManagerEmptyState,
  RequestPositionPanel,
  RequestRenamePanel,
} from '@/components/request-manager-panels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDisplayDate } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { LnkRequestExtensionOption } from '@/lib/lnk-request-extension'
import { LNK_METHODS } from '@/lib/report-config'
import { hasCompletedLnkRequestPosition } from '@/lib/report-control-state'
import { getLnkRowRequestMethods } from '@/lib/report-modal-rows'
import { useRequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { isSystemDocumentNameForRows } from '@/lib/system-document-types'
import {
  createRequestDocumentIdentity,
  isSameRequestDocument,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'

type LnkRequestMethod = (typeof LNK_METHODS)[number]
type RegistryFilter = 'all' | 'open' | 'fixed'

export type LnkRequestManagerDialogProps = {
  requestName: string
  requestDate: string
  requestOptions: LnkRequestExtensionOption[]
  requestRows: WeldRow[]
  requestMethods: LnkRequestMethod[]
  requestNameDraft: string
  isManagerPending: boolean
  isCorrectionPending: boolean
  canOpenDocument: boolean
  onClose: () => void
  onChangeRequest: (request: RequestDocumentIdentity) => void
  onCreateRequest: () => void
  onAddPositions: (request: LnkRequestExtensionOption) => void
  onOpenRows: () => void
  onOpenDocument: () => void
  onRequestNameDraftChange: (requestName: string) => void
  onRenameRequest: () => void
  onClearPosition: (row: WeldRow, requestKey: LnkRequestMethod['requestKey']) => void
  onDeleteRequest: () => void
}

export function LnkRequestManagerDialog({
  requestName,
  requestDate,
  requestOptions,
  requestRows,
  requestMethods,
  requestNameDraft,
  isManagerPending,
  isCorrectionPending,
  canOpenDocument,
  onClose,
  onChangeRequest,
  onCreateRequest,
  onAddPositions,
  onOpenRows,
  onOpenDocument,
  onRequestNameDraftChange,
  onRenameRequest,
  onClearPosition,
  onDeleteRequest,
}: LnkRequestManagerDialogProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<RegistryFilter>('all')
  const [showRequestSettings, setShowRequestSettings] = useState(false)
  const requestConclusionSettings = useRequestConclusionSettings()
  const selectedIdentity = createRequestDocumentIdentity(requestName, requestDate)
  const selectedOption = selectedIdentity
    ? requestOptions.find((request) => request.key === selectedIdentity.key)
    : undefined
  const isSystemRequest = isSystemDocumentNameForRows(
    requestRows,
    'lnkRequest',
    requestName,
    requestConclusionSettings,
  )
  const positionCount = LNK_METHODS.reduce(
    (count, method) =>
      count +
      requestRows.filter((row) =>
        isSameRequestDocument(row[method.requestKey], row[method.requestDateKey], {
          name: requestName,
          date: requestDate,
        }),
      ).length,
    0,
  )
  const completedPosition = requestRows.flatMap((row) =>
    LNK_METHODS.flatMap((method) =>
      isSameRequestDocument(row[method.requestKey], row[method.requestDateKey], {
        name: requestName,
        date: requestDate,
      }) && hasCompletedLnkRequestPosition(row, method)
        ? [{ row, method }]
        : [],
    ),
  )[0]
  const deleteBlockReason = completedPosition
    ? `Удаление недоступно: по стыку ${String(completedPosition.row.joint ?? '').trim() || `№${completedPosition.row.id}`}, ${completedPosition.method.code} уже внесен результат или заключение.`
    : null
  const filteredOptions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru')
    return requestOptions.filter((request) => {
      if (filter === 'open' && request.disabledReason) return false
      if (filter === 'fixed' && !request.disabledReason) return false
      if (!query) return true
      return `${request.label} ${request.methodCodes.join(' ')} ${request.searchText}`
        .toLocaleLowerCase('ru')
        .includes(query)
    })
  }, [filter, requestOptions, search])

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[1240px]"
      maxHeightClassName="h-[92vh]"
      overlayClassName="z-[60] bg-slate-950/30"
    >
      <RequestDialogHeader
        title="Заявки ЛНК"
        subtitle="Найдите заявку, проверьте ее состав или выполните доступное действие."
        onClose={onClose}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-slate-200 bg-slate-50/70 lg:border-b-0 lg:border-r">
          <div className="space-y-3 border-b border-slate-200 p-4">
            <Button className="w-full" onClick={onCreateRequest} disabled={isManagerPending || isCorrectionPending}>
              <Plus className="mr-2 h-4 w-4" />
              Новая заявка
            </Button>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Название, дата, стык или линия"
                className="h-10 bg-white pl-9"
              />
            </label>
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

          <div className="min-h-0 flex-1 overflow-y-auto p-2 lg:max-h-none">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-slate-500">
                {requestOptions.length === 0 ? 'Заявок ЛНК пока нет.' : 'По заданным условиям заявки не найдены.'}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredOptions.map((request) => {
                  const selected = request.key === selectedIdentity?.key
                  return (
                    <button
                      key={request.key}
                      type="button"
                      onClick={() => {
                        setShowRequestSettings(false)
                        onChangeRequest(request)
                      }}
                      className={`w-full rounded-md border px-3 py-3 text-left transition ${
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
                })}
              </div>
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
                      onClick={onOpenDocument}
                      disabled={!canOpenDocument || requestRows.length === 0}
                      title={!canOpenDocument ? 'Сначала загрузите шаблон заявки ЛНК в настройках документов' : undefined}
                    >
                      <FileSpreadsheet className="mr-2 h-4 w-4" />
                      Открыть документ
                    </Button>
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
                      Дата заявки фиксируется при создании. Системную заявку переименовать нельзя; пользовательскую можно переименовать без изменения состава.
                    </p>
                  </RequestRenamePanel>
                  <RequestDeletePanel
                    description={deleteBlockReason ?? 'Все ожидающие позиции будут исключены из этой заявки. Назначения видов НК сохранятся, выполненные контроли таким действием удалить нельзя.'}
                    disabled={!requestName || isManagerPending || Boolean(deleteBlockReason)}
                    onDelete={onDeleteRequest}
                  />
                </section>
              ) : null}

              <RequestPositionPanel
                title="Состав заявки"
                description="Кнопка вида НК исключает только эту позицию стыка. Другие виды НК и остальные стыки заявки не меняются; выполненный контроль исключить нельзя."
                hasRows={Boolean(requestName && requestRows.length > 0)}
                emptyText="В заявке больше нет позиций."
              >
                {requestRows.map((row) => {
                  const methods = getLnkRowRequestMethods(row, requestName, requestDate)
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
            </div>
          )}
        </main>
      </div>
    </LargeDialogShell>
  )
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
