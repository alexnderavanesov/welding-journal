import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil } from 'lucide-react'

import { LargeDialogShell } from '@/components/large-dialog-shell'
import { LnkRequestMethods } from '@/components/lnk-request-methods'
import { LnkRequestRow } from '@/components/lnk-request-row'
import { RequestDialogFooter } from '@/components/request-dialog-footer'
import { RequestDialogHeader } from '@/components/request-dialog-header'
import { RequestNamingControls } from '@/components/request-naming-controls'
import { RequestRowsPanel } from '@/components/request-rows-panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getDateInputValidationReason } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { buildLnkRequestDraftRows } from '@/lib/lnk-request-mutation-updates'
import { isEveryFilteredLnkRequestRowSelected } from '@/lib/report-modal-rows'
import { getRequestNameFromNaming } from '@/lib/report-naming'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { SaveCheckSettings } from '@/lib/save-check-settings'
import type { WeldFieldKey } from '@/lib/weld-fields'

export type LnkRequestDialogProps = {
  nextRequestName: string
  selectedRowsCount: number
  selectedRows: WeldRow[]
  selectedTargetCount: number
  requestNaming: RequestNamingState
  requestDate: string
  requestManagerOptions: string[]
  selectedMethodKeys: readonly WeldFieldKey[]
  selectedMethods: ReadonlySet<WeldFieldKey>
  requestSearch: string
  message?: string | null
  lnkRowsCount: number
  filteredRows: WeldRow[]
  filteredAvailableRows: WeldRow[]
  selectedIds: ReadonlySet<number>
  isPending: boolean
  saveCheckSettings: SaveCheckSettings
  onClose: () => void
  onOpenRequestManager: (requestName?: string) => void
  onRequestNamingChange: (value: RequestNamingState) => void
  onRequestDateChange: (value: string) => void
  onToggleMethod: (methodKey: WeldFieldKey) => void
  onRequestSearchChange: (value: string) => void
  onToggleAllRows: () => void
  onToggleRow: (rowId: number) => void
  onSubmit: () => void
}

export function LnkRequestDialog({
  nextRequestName,
  selectedRowsCount,
  selectedRows,
  selectedTargetCount,
  requestNaming,
  requestDate,
  requestManagerOptions,
  selectedMethodKeys,
  selectedMethods,
  requestSearch,
  message,
  lnkRowsCount,
  filteredRows,
  filteredAvailableRows,
  selectedIds,
  isPending,
  saveCheckSettings,
  onClose,
  onOpenRequestManager,
  onRequestNamingChange,
  onRequestDateChange,
  onToggleMethod,
  onRequestSearchChange,
  onToggleAllRows,
  onToggleRow,
  onSubmit,
}: LnkRequestDialogProps) {
  const hasSearch = requestSearch.trim().length > 0
  const allFilteredRowsSelected = isEveryFilteredLnkRequestRowSelected(selectedIds, filteredAvailableRows)
  const [showCreatedRequests, setShowCreatedRequests] = useState(false)
  const [createdRequestSearch, setCreatedRequestSearch] = useState('')
  const requestName = getRequestNameFromNaming(requestNaming, nextRequestName, requestDate)
  const requestDateReason = getDateInputValidationReason(requestDate, 'Дата заявки ЛНК')
  const chronologyReason = useMemo(() => {
    if (selectedRows.length === 0 || selectedMethodKeys.length === 0 || !requestName || requestDateReason) return ''
    const proposedRows = buildLnkRequestDraftRows({
      records: selectedRows,
      methodKeys: [...selectedMethodKeys],
      requestName,
      requestDate,
    })
    return getLnkChronologyIssues(proposedRows, saveCheckSettings)[0]?.message ?? ''
  }, [requestDate, requestDateReason, requestName, saveCheckSettings, selectedMethodKeys, selectedRows])
  const createDisabledReason = getLnkRequestCreateDisabledReason({
    selectedRowsCount,
    selectedMethodKeysCount: selectedMethodKeys.length,
    selectedTargetCount,
    requestName,
    requestDateReason,
    chronologyReason,
  })
  const feedbackMessage = createDisabledReason ?? message
  const filteredRequestManagerOptions = useMemo(() => {
    const query = createdRequestSearch.trim().toLowerCase()
    if (!query) return requestManagerOptions
    return requestManagerOptions.filter((requestName) => requestName.toLowerCase().includes(query))
  }, [createdRequestSearch, requestManagerOptions])

  return (
    <LargeDialogShell overlayClassName="z-50 bg-slate-950/20" panelShadowClassName="shadow-slate-950/10">
      <RequestDialogHeader
        title="Создание заявки ЛНК"
        subtitle={`${nextRequestName} · Стыков: ${selectedRowsCount} · Позиций: ${selectedTargetCount}`}
        onClose={onClose}
      />

      {!showCreatedRequests ? (
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
                customDate={requestDate}
                onChange={onRequestNamingChange}
              />
            </div>
          </div>
        </div>
      ) : null}

      {showCreatedRequests ? (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-5">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Созданные заявки</h3>
              <p className="text-xs text-muted-foreground">Найдите заявку и откройте ее редактирование.</p>
            </div>
            <span className="text-xs text-slate-500">Найдено: {filteredRequestManagerOptions.length}</span>
          </div>

          <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <input
              value={createdRequestSearch}
              onChange={(event) => setCreatedRequestSearch(event.target.value)}
              placeholder="Поиск по названию заявки"
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-slate-200">
            {filteredRequestManagerOptions.length === 0 ? (
              <div className="flex min-h-40 items-center justify-center px-4 text-sm text-slate-500">
                {requestManagerOptions.length === 0 ? 'Созданных заявок ЛНК пока нет.' : 'По поиску заявка не найдена.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredRequestManagerOptions.map((requestName) => (
                  <button
                    key={requestName}
                    type="button"
                    onClick={() => onOpenRequestManager(requestName)}
                    className="flex w-full items-center justify-between gap-3 bg-white px-4 py-3 text-left transition hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">{requestName}</span>
                      <span className="text-xs text-slate-500">Открыть управление заявкой</span>
                    </span>
                    <span className="inline-flex shrink-0 items-center rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      Изменить
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-6 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <LnkRequestMethods
            selectedMethodKeys={selectedMethodKeys}
            selectedMethods={selectedMethods}
            onToggleMethod={onToggleMethod}
          />

          <RequestRowsPanel
            title="Стыки"
            description="Галочка доступна только там, где есть хотя бы один вид контроля без заявки."
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
              {filteredAvailableRows.map((row) => (
                <LnkRequestRow
                  key={row.id}
                  row={row}
                  selected={selectedIds.has(row.id)}
                  selectedMethods={selectedMethods}
                  onToggleRow={onToggleRow}
                />
              ))}
            </div>
          </RequestRowsPanel>
        </div>
      )}

      <div className="border-t border-slate-200/80 px-6 py-4">
        <button
          type="button"
          onClick={() => setShowCreatedRequests((current) => !current)}
          className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left transition-colors ${
            showCreatedRequests
              ? 'border-sky-300 bg-sky-50 shadow-sm shadow-sky-100'
              : 'border-slate-200 bg-slate-50 hover:border-sky-200 hover:bg-sky-50'
          }`}
        >
          <span>
            <span className={`block text-sm font-semibold ${showCreatedRequests ? 'text-sky-950' : 'text-slate-900'}`}>
              Созданные заявки
            </span>
            <span className="text-xs text-slate-500">
              {requestManagerOptions.length > 0 ? `${requestManagerOptions.length} заявок` : 'пока нет заявок'}
            </span>
          </span>
          {showCreatedRequests ? (
            <ChevronDown className="h-4 w-4 text-sky-700" />
          ) : (
            <ChevronUp className="h-4 w-4 text-slate-500" />
          )}
        </button>
      </div>

      <RequestDialogFooter
        isPending={isPending}
        isCreateDisabled={Boolean(createDisabledReason)}
        disabledReason={feedbackMessage}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </LargeDialogShell>
  )
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
