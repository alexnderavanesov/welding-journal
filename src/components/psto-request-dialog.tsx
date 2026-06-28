import { Pencil } from 'lucide-react'

import { PstoRequestAside } from '@/components/psto-request-aside'
import { PstoRequestRow } from '@/components/psto-request-row'
import { RequestDialogFooter } from '@/components/request-dialog-footer'
import { RequestDialogHeader } from '@/components/request-dialog-header'
import { RequestNamingControls } from '@/components/request-naming-controls'
import { RequestRowsSearch } from '@/components/request-rows-search'
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
      <div className="flex h-[94vh] w-full max-w-[1480px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
        <RequestDialogHeader
          title="Создание заявки ПСТО"
          subtitle={`${nextRequestName} · Стыков: ${selectedRows.length}`}
          onClose={onClose}
          actions={
            <Button
              variant="outline"
              onClick={onOpenRequestManager}
              disabled={requestManagerOptions.length === 0}
              className="border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <Pencil className="mr-2 h-4 w-4" />
              Управление заявками
            </Button>
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

          <section className="flex min-h-0 flex-col space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Стыки</h3>
                <p className="text-xs leading-5 text-slate-500">Галочка доступна только там, где заявка ПСТО еще не создана.</p>
              </div>
              <Button variant="outline" size="sm" onClick={onToggleAllRows}>
                {areAllAvailableRowsSelected ? 'Снять все' : 'Выбрать доступные'}
              </Button>
            </div>

            <RequestRowsSearch
              value={requestSearch}
              placeholder="Проект, шифр, линия, спул или стык"
              filteredCount={filteredRows.length}
              availableCount={availableRowsCount}
              onChange={onRequestSearchChange}
            />

            <div className="min-h-0 overflow-auto rounded-md border border-slate-200">
              {filteredRows.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500">
                  {heatTreatmentRowsCount === 0 ? 'Нет стыков для отчета Термообработка.' : 'По фильтру ничего не найдено.'}
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredRows.map((row) => {
                    const disabled = !canCreateRequest(row)
                    const selected = selectedIds.has(row.id)
                    return (
                      <PstoRequestRow
                        key={row.id}
                        row={row}
                        selected={selected}
                        disabled={disabled}
                        onToggleRow={onToggleRow}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        </div>

        <RequestDialogFooter
          isPending={isPending}
          isCreateDisabled={selectedRows.length === 0}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      </div>
    </div>
  )
}
