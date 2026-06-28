import { LargeDialogShell } from '@/components/large-dialog-shell'
import { LnkRequestMethods } from '@/components/lnk-request-methods'
import { LnkRequestRow } from '@/components/lnk-request-row'
import { RequestDialogFooter } from '@/components/request-dialog-footer'
import { RequestDialogHeader } from '@/components/request-dialog-header'
import { RequestManagerButton } from '@/components/request-manager-button'
import { RequestNamingControls } from '@/components/request-naming-controls'
import { RequestRowsPanel } from '@/components/request-rows-panel'
import { Button } from '@/components/ui/button'
import type { WeldRow } from '@/lib/dispatcher-types'
import { isEveryFilteredLnkRequestRowSelected } from '@/lib/report-modal-rows'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { WeldFieldKey } from '@/lib/weld-fields'

export type LnkRequestDialogProps = {
  nextRequestName: string
  selectedRowsCount: number
  selectedTargetCount: number
  requestNaming: RequestNamingState
  requestManagerOptions: string[]
  selectedMethodKeys: readonly WeldFieldKey[]
  selectedMethods: ReadonlySet<WeldFieldKey>
  requestSearch: string
  lnkRowsCount: number
  filteredRows: WeldRow[]
  filteredAvailableRows: WeldRow[]
  selectedIds: ReadonlySet<number>
  isPending: boolean
  onClose: () => void
  onOpenRequestManager: () => void
  onRequestNamingChange: (value: RequestNamingState) => void
  onToggleMethod: (methodKey: WeldFieldKey) => void
  onRequestSearchChange: (value: string) => void
  onToggleAllRows: () => void
  onToggleRow: (rowId: number) => void
  onSubmit: () => void
}

export function LnkRequestDialog({
  nextRequestName,
  selectedRowsCount,
  selectedTargetCount,
  requestNaming,
  requestManagerOptions,
  selectedMethodKeys,
  selectedMethods,
  requestSearch,
  lnkRowsCount,
  filteredRows,
  filteredAvailableRows,
  selectedIds,
  isPending,
  onClose,
  onOpenRequestManager,
  onRequestNamingChange,
  onToggleMethod,
  onRequestSearchChange,
  onToggleAllRows,
  onToggleRow,
  onSubmit,
}: LnkRequestDialogProps) {
  const hasSearch = requestSearch.trim().length > 0
  const allFilteredRowsSelected = isEveryFilteredLnkRequestRowSelected(selectedIds, filteredAvailableRows)

  return (
    <LargeDialogShell overlayClassName="z-50 bg-slate-950/20" panelShadowClassName="shadow-slate-950/10">
      <RequestDialogHeader
        title="Создание заявки ЛНК"
        subtitle={`${nextRequestName} · Стыков: ${selectedRowsCount} · Позиций: ${selectedTargetCount}`}
        onClose={onClose}
      />

      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <RequestNamingControls
              naming={requestNaming}
              systemName={nextRequestName}
              label="Наименование заявки ЛНК"
              onChange={onRequestNamingChange}
            />
          </div>
          <RequestManagerButton disabled={requestManagerOptions.length === 0} onClick={onOpenRequestManager} />
        </div>
      </div>

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

      <RequestDialogFooter
        isPending={isPending}
        isCreateDisabled={selectedTargetCount === 0}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </LargeDialogShell>
  )
}
