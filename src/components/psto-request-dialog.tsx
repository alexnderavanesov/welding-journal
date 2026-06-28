import { LargeDialogShell } from '@/components/large-dialog-shell'
import { PstoRequestAside } from '@/components/psto-request-aside'
import { PstoRequestRow } from '@/components/psto-request-row'
import { RequestDialogFooter } from '@/components/request-dialog-footer'
import { RequestDialogHeader } from '@/components/request-dialog-header'
import { RequestManagerButton } from '@/components/request-manager-button'
import { RequestNamingControls } from '@/components/request-naming-controls'
import { RequestRowsPanel } from '@/components/request-rows-panel'
import { Button } from '@/components/ui/button'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RequestNamingState } from '@/lib/request-naming-state'

export type PstoRequestDialogProps = {
  nextRequestName: string
  selectedRows: WeldRow[]
  requestNaming: RequestNamingState
  requestSearch: string
  requestManagerOptions: string[]
  heatTreatmentRowsCount: number
  filteredRows: WeldRow[]
  availableRowsCount: number
  selectedIds: ReadonlySet<number>
  areAllAvailableRowsSelected: boolean
  isPending: boolean
  canCreateRequest: (row: WeldRow) => boolean
  onClose: () => void
  onOpenRequestManager: () => void
  onRequestNamingChange: (value: RequestNamingState) => void
  onRequestSearchChange: (value: string) => void
  onToggleAllRows: () => void
  onToggleRow: (rowId: number) => void
  onSubmit: () => void
}

export function PstoRequestDialog({
  nextRequestName,
  selectedRows,
  requestNaming,
  requestSearch,
  requestManagerOptions,
  heatTreatmentRowsCount,
  filteredRows,
  availableRowsCount,
  selectedIds,
  areAllAvailableRowsSelected,
  isPending,
  canCreateRequest,
  onClose,
  onOpenRequestManager,
  onRequestNamingChange,
  onRequestSearchChange,
  onToggleAllRows,
  onToggleRow,
  onSubmit,
}: PstoRequestDialogProps) {
  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[1480px]"
      maxHeightClassName="h-[94vh]"
      overlayClassName="z-50 bg-slate-950/20"
      panelShadowClassName="shadow-slate-950/10"
    >
      <RequestDialogHeader
        title="Создание заявки ПСТО"
        subtitle={`${nextRequestName} · Стыков: ${selectedRows.length}`}
        onClose={onClose}
        actions={
          <RequestManagerButton disabled={requestManagerOptions.length === 0} onClick={onOpenRequestManager} />
        }
      />

      <div className="border-b border-slate-100 px-5 py-4">
        <RequestNamingControls
          naming={requestNaming}
          systemName={nextRequestName}
          label="Наименование заявки ПСТО"
          onChange={onRequestNamingChange}
        />
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
            {filteredRows.map((row) => {
              const disabled = !canCreateRequest(row)
              const selected = selectedIds.has(row.id)
              return <PstoRequestRow key={row.id} row={row} selected={selected} disabled={disabled} onToggleRow={onToggleRow} />
            })}
          </div>
        </RequestRowsPanel>
      </div>

      <RequestDialogFooter
        isPending={isPending}
        isCreateDisabled={selectedRows.length === 0}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </LargeDialogShell>
  )
}
