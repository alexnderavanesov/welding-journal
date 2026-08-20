import { useEffect, useMemo, useState } from 'react'
import { ListFilter } from 'lucide-react'

import { LargeDialogShell } from '@/components/large-dialog-shell'
import { LnkRequestMethods } from '@/components/lnk-request-methods'
import { LnkRequestRow } from '@/components/lnk-request-row'
import { PaginationBar } from '@/components/pagination-bar'
import { RequestDialogFooter } from '@/components/request-dialog-footer'
import { RequestDialogHeader } from '@/components/request-dialog-header'
import { RequestNamingControls } from '@/components/request-naming-controls'
import { RequestRowsPanel } from '@/components/request-rows-panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { getDateInputValidationReason } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { buildLnkRequestDraftRows } from '@/lib/lnk-request-mutation-updates'
import {
  analyzeLnkRequestExtensionTargets,
  type LnkRequestExtensionOption,
} from '@/lib/lnk-request-extension'
import { countLnkRequestTargets, isEveryFilteredLnkRequestRowSelected } from '@/lib/report-modal-rows'
import { getRequestNameFromNaming } from '@/lib/report-naming'
import { pinInitiallySelectedRows } from '@/lib/report-row-utils'
import type { RequestNamingState } from '@/lib/request-naming-state'
import { formatSaveCheckBlockReason, type SaveCheckSettings } from '@/lib/save-check-settings'
import { usePagination } from '@/lib/use-pagination'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { LnkRequestComposerMode } from '@/lib/use-lnk-request-modal-state'

export type LnkRequestDialogProps = {
  nextRequestName: string
  selectedRowsCount: number
  selectedRows: WeldRow[]
  requestNaming: RequestNamingState
  requestDate: string
  requestExtensionOptions: LnkRequestExtensionOption[]
  initialMode: LnkRequestComposerMode
  initialRequestKey: string
  initialSelectedMethods: ReadonlySet<WeldFieldKey>
  requestSearch: string
  message?: string | null
  lnkRowsCount: number
  filteredRows: WeldRow[]
  filteredAvailableRows: WeldRow[]
  selectedIds: ReadonlySet<number>
  isPending: boolean
  saveCheckSettings: SaveCheckSettings
  onClose: () => void
  onOpenRequestRegistry: () => void
  onRequestNamingChange: (value: RequestNamingState) => void
  onRequestDateChange: (value: string) => void
  onRequestSearchChange: (value: string) => void
  onToggleAllRows: () => void
  onToggleRow: (rowId: number) => void
  onSubmit: (methodKeys: WeldFieldKey[]) => void
  onExtendRequest: (methodKeys: WeldFieldKey[], request: LnkRequestExtensionOption) => void
}

export function LnkRequestDialog({
  nextRequestName,
  selectedRowsCount,
  selectedRows,
  requestNaming,
  requestDate,
  requestExtensionOptions,
  initialMode,
  initialRequestKey,
  initialSelectedMethods,
  requestSearch,
  message,
  lnkRowsCount,
  filteredRows,
  filteredAvailableRows,
  selectedIds,
  isPending,
  saveCheckSettings,
  onClose,
  onOpenRequestRegistry,
  onRequestNamingChange,
  onRequestDateChange,
  onRequestSearchChange,
  onToggleAllRows,
  onToggleRow,
  onSubmit,
  onExtendRequest,
}: LnkRequestDialogProps) {
  const [submitMode, setSubmitMode] = useState<LnkRequestComposerMode>(initialMode)
  const [existingRequestKey, setExistingRequestKey] = useState(initialRequestKey)
  const [selectedMethods, setSelectedMethods] = useState(() => new Set(initialSelectedMethods))
  const [initiallySelectedIds] = useState(() => new Set(selectedIds))
  const selectedMethodKeys = useMemo(() => [...selectedMethods], [selectedMethods])
  const createTargetCount = useMemo(
    () => countLnkRequestTargets(selectedRows, selectedMethodKeys),
    [selectedMethodKeys, selectedRows],
  )
  const selectedExistingRequest = useMemo(
    () => requestExtensionOptions.find((request) => request.key === existingRequestKey),
    [existingRequestKey, requestExtensionOptions],
  )
  useEffect(() => {
    if (submitMode !== 'extend' || selectedExistingRequest) return
    setExistingRequestKey(
      requestExtensionOptions.find((request) => !request.disabledReason)?.key ?? requestExtensionOptions[0]?.key ?? '',
    )
  }, [requestExtensionOptions, selectedExistingRequest, submitMode])
  const extensionAnalysis = useMemo(
    () => analyzeLnkRequestExtensionTargets({
      rows: selectedRows,
      methodKeys: selectedMethodKeys,
      requestName: selectedExistingRequest?.name ?? '',
      requestDate: selectedExistingRequest?.date ?? '',
    }),
    [selectedExistingRequest?.date, selectedExistingRequest?.name, selectedMethodKeys, selectedRows],
  )
  const selectedTargetCount = submitMode === 'create' ? createTargetCount : extensionAnalysis.targets.length
  const hasSearch = requestSearch.trim().length > 0
  const orderedAvailableRows = useMemo(
    () => pinInitiallySelectedRows(filteredAvailableRows, selectedIds, initiallySelectedIds),
    [filteredAvailableRows, initiallySelectedIds, selectedIds],
  )
  const paginationResetKeys = useMemo(
    () => [requestSearch, orderedAvailableRows],
    [orderedAvailableRows, requestSearch],
  )
  const rowsPagination = usePagination({
    items: orderedAvailableRows,
    defaultPageSize: 100,
    resetKeys: paginationResetKeys,
  })
  const allFilteredRowsSelected = isEveryFilteredLnkRequestRowSelected(selectedIds, filteredAvailableRows)
  const requestName = submitMode === 'create' ? getRequestNameFromNaming(requestNaming, nextRequestName) : ''
  const requestDateReason = submitMode === 'create' ? getDateInputValidationReason(requestDate, 'Дата заявки ЛНК') : null
  const chronologyReason = useMemo(() => {
    if (selectedRows.length === 0 || selectedMethodKeys.length === 0 || !requestName || requestDateReason) return ''
    const proposedRows = buildLnkRequestDraftRows({
      records: selectedRows,
      methodKeys: [...selectedMethodKeys],
      requestName,
      requestDate,
    })
    const issue = getLnkChronologyIssues(proposedRows, saveCheckSettings)[0]
    return issue ? formatSaveCheckBlockReason('lnkResultRequestDateOrder', issue.message) : ''
  }, [requestDate, requestDateReason, requestName, saveCheckSettings, selectedMethodKeys, selectedRows])
  const createDisabledReason = submitMode === 'create'
    ? getLnkRequestCreateDisabledReason({
        selectedRowsCount,
        selectedMethodKeysCount: selectedMethodKeys.length,
        selectedTargetCount,
        requestName,
        requestDateReason,
        chronologyReason,
      })
    : getLnkRequestExtendDisabledReason({
        selectedRowsCount,
        selectedMethodKeysCount: selectedMethodKeys.length,
        selectedTargetCount,
        selectedRequest: selectedExistingRequest,
        firstIssueReason: extensionAnalysis.issues[0]?.reason,
      })
  const feedbackMessage = createDisabledReason ?? message
  const extensionIssueSummary = formatLnkRequestExtensionIssueSummary(extensionAnalysis.issues)
  return (
    <LargeDialogShell
      maxHeightClassName="h-[92vh]"
      overlayClassName="z-50 bg-slate-950/20"
      panelShadowClassName="shadow-slate-950/10"
    >
      <RequestDialogHeader
        title="Заявка ЛНК"
        subtitle={`${submitMode === 'create' ? nextRequestName : selectedExistingRequest?.label ?? 'Выберите заявку'} · Стыков: ${selectedRowsCount} · Добавится позиций: ${selectedTargetCount}`}
        onClose={onClose}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-3">
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Режим заявки ЛНК">
            <button
              type="button"
              aria-pressed={submitMode === 'create'}
              onClick={() => setSubmitMode('create')}
              className={`rounded px-4 py-2 text-sm font-medium transition ${
                submitMode === 'create' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Новая заявка
            </button>
            <button
              type="button"
              aria-pressed={submitMode === 'extend'}
              onClick={() => setSubmitMode('extend')}
              className={`rounded px-4 py-2 text-sm font-medium transition ${
                submitMode === 'extend' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Добавить в существующую
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={onOpenRequestRegistry}>
            <ListFilter className="mr-2 h-4 w-4" />
            Все заявки
          </Button>
      </div>

      {submitMode === 'create' ? (
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <label className="block space-y-1.5 text-sm">
              <span className="text-[13px] font-medium leading-none text-slate-700">Дата заявки</span>
              <Input
                type="date"
                value={requestDate}
                onChange={(event) => onRequestDateChange(event.target.value)}
                className="h-10 bg-white"
              />
              <span className="block text-xs leading-4 text-slate-500">
                Для системного имени заявка будет названа по этой дате.
              </span>
            </label>
            <div className="min-w-0">
              <RequestNamingControls
                naming={requestNaming}
                systemName={nextRequestName}
                label="Наименование заявки ЛНК"
                onChange={onRequestNamingChange}
              />
            </div>
          </div>
        </div>
      ) : null}

      {submitMode === 'extend' ? (
        <div className="border-b border-slate-100 px-6 py-4">
          <label className="block space-y-1.5 text-sm">
            <span className="text-[13px] font-medium leading-none text-slate-700">Существующая заявка</span>
            <Select value={existingRequestKey} onChange={(event) => setExistingRequestKey(event.target.value)}>
              <option value="">Выберите заявку</option>
              {requestExtensionOptions.map((request) => (
                <option key={request.key} value={request.key}>
                  {request.label} · {request.positionCount} поз.{request.disabledReason ? ' · закрыта' : ''}
                </option>
              ))}
            </Select>
          </label>

          {selectedExistingRequest ? (
            <div
              data-request-extension-summary="true"
              className={`mt-3 h-[72px] overflow-y-auto rounded-md border px-3 py-2 ${
              selectedExistingRequest.disabledReason
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-sky-200 bg-sky-50 text-sky-900'
              }`}
            >
              {selectedExistingRequest.disabledReason ? (
                <p className="text-xs font-medium leading-5">{selectedExistingRequest.disabledReason}</p>
              ) : (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                  <span>Сейчас: <strong>{selectedExistingRequest.rowCount}</strong> стыков</span>
                  <span><strong>{selectedExistingRequest.positionCount}</strong> позиций НК</span>
                  <span>Добавится: <strong>{extensionAnalysis.targets.length}</strong> позиций</span>
                </div>
              )}
              {!selectedExistingRequest.disabledReason ? (
                <p className="mt-2 border-t border-sky-200 pt-2 text-xs leading-5 text-sky-800">
                  {extensionIssueSummary || (extensionAnalysis.targets.length > 0
                    ? `Войдут все выбранные позиции: ${extensionAnalysis.targets.length}.`
                    : 'Выберите виды контроля и стыки, чтобы увидеть состав добавления.')}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              {requestExtensionOptions.length === 0 ? 'Созданных заявок ЛНК пока нет.' : 'Выберите заявку из списка.'}
            </p>
          )}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-6 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <LnkRequestMethods
            selectedMethodKeys={selectedMethodKeys}
            selectedMethods={selectedMethods}
            onToggleMethod={(methodKey) => {
              setSelectedMethods((current) => {
                const next = new Set(current)
                if (next.has(methodKey)) next.delete(methodKey)
                else next.add(methodKey)
                return next
              })
            }}
          />

          <RequestRowsPanel
            title="Стыки"
            description={submitMode === 'create'
              ? 'Галочка доступна только там, где есть хотя бы один вид контроля без заявки.'
              : 'Выберите стыки и виды контроля, которые нужно добавить в выбранную открытую заявку.'}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={onToggleAllRows}
                disabled={!hasSearch || filteredAvailableRows.length === 0}
                title={!hasSearch ? 'Сначала сузьте список поиском' : undefined}
              >
                {allFilteredRowsSelected ? 'Снять все' : 'Выбрать доступные'}
              </Button>
            }
            searchValue={requestSearch}
            searchPlaceholder="Линия, спул или стык"
            filteredCount={filteredRows.length}
            availableCount={filteredAvailableRows.length}
            isEmpty={filteredAvailableRows.length === 0}
            emptyMessage={
              lnkRowsCount === 0
                ? 'Нет стыков для отчета ЛНК.'
                : filteredRows.length === 0
                  ? 'По фильтру ничего не найдено.'
                  : 'По найденным стыкам нет доступных методов для новой заявки.'
            }
            onSearchChange={onRequestSearchChange}
          >
            <div className="divide-y divide-slate-100">
              {rowsPagination.pageItems.map((row) => (
                <LnkRequestRow
                  key={row.id}
                  row={row}
                  selected={selectedIds.has(row.id)}
                  selectedMethods={selectedMethods}
                  onToggleRow={onToggleRow}
                />
              ))}
            </div>
            <div className="p-3">
              <PaginationBar
                totalCount={rowsPagination.totalCount}
                firstItemNumber={rowsPagination.firstItemNumber}
                lastItemNumber={rowsPagination.lastItemNumber}
                pageSize={rowsPagination.pageSize}
                hasMore={rowsPagination.hasMore}
                onLoadMore={rowsPagination.loadMore}
                onPageSizeChange={rowsPagination.setPageSize}
              />
            </div>
          </RequestRowsPanel>
      </div>

      <RequestDialogFooter
        isPending={isPending}
        isCreateDisabled={Boolean(createDisabledReason)}
        disabledReason={feedbackMessage}
        onClose={onClose}
        submitLabel={submitMode === 'create' ? 'Создать заявку' : 'Добавить в заявку'}
        onSubmit={() => {
          if (submitMode === 'create') onSubmit(selectedMethodKeys)
          else if (selectedExistingRequest) onExtendRequest(selectedMethodKeys, selectedExistingRequest)
        }}
      />
    </LargeDialogShell>
  )
}

function getLnkRequestExtendDisabledReason({
  selectedRowsCount,
  selectedMethodKeysCount,
  selectedTargetCount,
  selectedRequest,
  firstIssueReason,
}: {
  selectedRowsCount: number
  selectedMethodKeysCount: number
  selectedTargetCount: number
  selectedRequest: LnkRequestExtensionOption | undefined
  firstIssueReason?: string
}) {
  if (!selectedRequest) return 'Выберите существующую заявку ЛНК.'
  if (selectedRequest.disabledReason) return selectedRequest.disabledReason
  if (selectedRowsCount === 0) return 'Выберите один или несколько стыков для добавления в заявку ЛНК.'
  if (selectedMethodKeysCount === 0) return 'Выберите один или несколько видов контроля для добавления в заявку ЛНК.'
  if (selectedTargetCount === 0) {
    return firstIssueReason
      ? `Нет доступных позиций: ${firstIssueReason}`
      : 'По выбранным стыкам и видам контроля нет позиций для добавления в эту заявку.'
  }
  return null
}

function formatLnkRequestExtensionIssueSummary(
  issues: Array<{ reason: string }>,
) {
  if (issues.length === 0) return ''
  const reasonCounts = new Map<string, number>()
  for (const issue of issues) reasonCounts.set(issue.reason, (reasonCounts.get(issue.reason) ?? 0) + 1)
  const details = [...reasonCounts.entries()]
    .slice(0, 2)
    .map(([reason, count]) => `${count} — ${reason}`)
    .join(' ')
  const remainingReasonCount = Math.max(0, reasonCounts.size - 2)
  return `Не войдут ${issues.length} позиций: ${details}${remainingReasonCount ? ` Еще причин: ${remainingReasonCount}.` : ''}`
}

function getLnkRequestCreateDisabledReason({
  selectedRowsCount,
  selectedMethodKeysCount,
  selectedTargetCount,
  requestName,
  requestDateReason,
  chronologyReason,
}: {
  selectedRowsCount: number
  selectedMethodKeysCount: number
  selectedTargetCount: number
  requestName: string
  requestDateReason: string | null
  chronologyReason: string
}) {
  if (selectedRowsCount === 0) return 'Чтобы создать заявку ЛНК, выберите один или несколько стыков.'
  if (selectedMethodKeysCount === 0) return 'Чтобы создать заявку ЛНК, выберите один или несколько видов контроля.'
  if (selectedTargetCount === 0) {
    return 'По выбранным стыкам и видам контроля нет доступных позиций: заявка уже создана, контроль не назначен или стык больше не доступен для новой заявки.'
  }
  if (!requestName) return 'Укажите пользовательское наименование заявки ЛНК или переключитесь на системное имя.'
  if (requestDateReason) return requestDateReason
  if (chronologyReason) return chronologyReason
  return null
}
