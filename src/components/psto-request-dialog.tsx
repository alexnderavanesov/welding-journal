import { useMemo } from 'react'

import { DialogRowPagination } from '@/components/dialog-row-pagination'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { PstoRequestAside } from '@/components/psto-request-aside'
import { PstoRequestRow } from '@/components/psto-request-row'
import { RequestDialogFooter } from '@/components/request-dialog-footer'
import { RequestDialogHeader } from '@/components/request-dialog-header'
import { RequestManagerButton } from '@/components/request-manager-button'
import { RequestNamingControls } from '@/components/request-naming-controls'
import { RequestRowsPanel } from '@/components/request-rows-panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getDateInputValidationReason } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getPstoChronologyIssues } from '@/lib/psto-chronology-checks'
import { buildPstoRequestDraftRows } from '@/lib/psto-report-mutation-updates'
import { getRequestNameFromNaming } from '@/lib/report-naming'
import type { RequestNamingState } from '@/lib/request-naming-state'
import { formatSaveCheckBlockReason, type SaveCheckSettings } from '@/lib/save-check-settings'
import { usePagePagination } from '@/lib/use-page-pagination'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'
import type { RequestDocumentIdentity } from '@/lib/request-document-identity'
import { useRequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { buildSystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import { SystemDocumentSplitPreview } from '@/components/system-document-split-preview'

export type PstoRequestDialogProps = {
  nextRequestName: string
  nextRequestNumber?: number
  selectedRows: WeldRow[]
  requestNaming: RequestNamingState
  requestDate: string
  requestSearch: string
  message?: string | null
  requestManagerOptions: RequestDocumentIdentity[]
  heatTreatmentRowsCount: number
  filteredRows: WeldRow[]
  availableRowsCount: number
  selectedIds: ReadonlySet<number>
  areAllAvailableRowsSelected: boolean
  isPending: boolean
  saveCheckSettings: SaveCheckSettings
  canCreateRequest: (row: WeldRow) => boolean
  onClose: () => void
  onOpenRequestManager: () => void
  onRequestNamingChange: (value: RequestNamingState) => void
  onRequestDateChange: (value: string) => void
  onRequestSearchChange: (value: string) => void
  onToggleAllRows: () => void
  onToggleRow: (rowId: number) => void
  onSubmit: () => void
}

export function PstoRequestDialog({
  nextRequestName,
  nextRequestNumber,
  selectedRows,
  requestNaming,
  requestDate,
  requestSearch,
  message,
  requestManagerOptions,
  heatTreatmentRowsCount,
  filteredRows,
  availableRowsCount,
  selectedIds,
  areAllAvailableRowsSelected,
  isPending,
  saveCheckSettings,
  canCreateRequest,
  onClose,
  onOpenRequestManager,
  onRequestNamingChange,
  onRequestDateChange,
  onRequestSearchChange,
  onToggleAllRows,
  onToggleRow,
  onSubmit,
}: PstoRequestDialogProps) {
  const requestConclusionSettings = useRequestConclusionSettings()
  const stableOnToggleRow = useStableEventCallback(onToggleRow)
  const paginationResetKeys = useMemo(() => [requestSearch], [requestSearch])
  const rowsPagination = usePagePagination({
    items: filteredRows,
    defaultPageSize: 50,
    resetKeys: paginationResetKeys,
  })
  const requestName = getRequestNameFromNaming(requestNaming, nextRequestName)
  const creationPlan = useMemo(() => buildSystemDocumentCreationPlan({
    type: 'pstoRequest',
    date: requestDate,
    rows: selectedRows,
    naming: requestNaming,
    settings: requestConclusionSettings,
    nextNumber: nextRequestNumber,
  }), [nextRequestNumber, requestConclusionSettings, requestDate, requestNaming, selectedRows])
  const effectiveRequestName = creationPlan.groups[0]?.name ?? requestName
  const requestDateReason = getDateInputValidationReason(requestDate, 'Дата заявки ПСТО')
  const chronologyReason = useMemo(() => {
    if (selectedRows.length === 0 || !effectiveRequestName || requestDateReason) return ''
    const proposedRows = buildPstoRequestDraftRows({ records: selectedRows, requestName: effectiveRequestName, requestDate })
    const issue = getPstoChronologyIssues(proposedRows, saveCheckSettings)[0]
    return issue ? formatSaveCheckBlockReason('pstoResultRequestDateOrder', issue.message) : ''
  }, [effectiveRequestName, requestDate, requestDateReason, saveCheckSettings, selectedRows])
  const createDisabledReason = getPstoRequestCreateDisabledReason({
    selectedRowsCount: selectedRows.length,
    requestName: effectiveRequestName,
    requestDateReason,
    chronologyReason,
    creationPlanError: creationPlan.error,
  })
  const feedbackMessage = createDisabledReason ?? message
  const headerDocumentLabel = creationPlan.groups.length > 1
    ? `Будет создано заявок: ${creationPlan.groups.length}`
    : effectiveRequestName || 'Новая заявка'

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[1480px]"
      maxHeightClassName="h-[94vh]"
      overlayClassName="z-50 bg-slate-950/20"
      panelShadowClassName="shadow-slate-950/10"
    >
      <RequestDialogHeader
        title="Создание заявки ПСТО"
        subtitle={`${headerDocumentLabel} · Стыков: ${selectedRows.length}`}
        onClose={onClose}
        actions={
          <RequestManagerButton disabled={requestManagerOptions.length === 0} onClick={onOpenRequestManager} />
        }
      />

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
              systemDocumentCount={creationPlan.groups.length}
              label="Наименование заявки ПСТО"
              onChange={onRequestNamingChange}
              hideCustomNameInput={requestNaming.mode === 'custom' && creationPlan.groups.length > 1}
            />
            <div className="mt-3">
              <SystemDocumentSplitPreview
                plan={creationPlan}
                naming={requestNaming}
                disabled={isPending}
                onNamingChange={onRequestNamingChange}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-6 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <PstoRequestAside />

        <RequestRowsPanel
          title="Стыки"
          description="Галочка доступна только там, где заявка ПСТО еще не создана."
          action={
            <Button variant="outline" size="sm" onClick={onToggleAllRows}>
              {areAllAvailableRowsSelected ? 'Снять все' : 'Выбрать доступные'}
            </Button>
          }
          searchValue={requestSearch}
          searchPlaceholder="Проект, шифр, линия, спул или стык"
          filteredCount={filteredRows.length}
          availableCount={availableRowsCount}
          isEmpty={filteredRows.length === 0}
          emptyMessage={
            heatTreatmentRowsCount === 0 ? 'Нет стыков для отчета Термообработка.' : 'По фильтру ничего не найдено.'
          }
          onSearchChange={onRequestSearchChange}
        >
          <div className="divide-y divide-slate-100">
            {rowsPagination.pageItems.map((row) => {
              const disabled = !canCreateRequest(row)
              const selected = selectedIds.has(row.id)
              return <PstoRequestRow key={row.id} row={row} selected={selected} disabled={disabled} onToggleRow={stableOnToggleRow} />
            })}
          </div>
          <DialogRowPagination
            totalCount={rowsPagination.totalCount}
            firstItemNumber={rowsPagination.firstItemNumber}
            lastItemNumber={rowsPagination.lastItemNumber}
            page={rowsPagination.page}
            pageCount={rowsPagination.pageCount}
            pageSize={rowsPagination.pageSize}
            onPreviousPage={rowsPagination.goToPreviousPage}
            onNextPage={rowsPagination.goToNextPage}
            onPageSizeChange={rowsPagination.setPageSize}
          />
        </RequestRowsPanel>
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

function getPstoRequestCreateDisabledReason({
  selectedRowsCount,
  requestName,
  requestDateReason,
  chronologyReason,
  creationPlanError,
}: {
  selectedRowsCount: number
  requestName: string
  requestDateReason: string | null
  chronologyReason: string
  creationPlanError: string
}) {
  if (selectedRowsCount === 0) return 'Чтобы создать заявку ПСТО, выберите один или несколько стыков.'
  if (!requestName) return 'Укажите пользовательское наименование заявки ПСТО или переключитесь на системное имя.'
  if (creationPlanError) return creationPlanError
  if (requestDateReason) return requestDateReason
  if (chronologyReason) return chronologyReason
  return null
}
