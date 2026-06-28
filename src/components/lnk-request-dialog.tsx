import { Pencil } from 'lucide-react'

import { LnkRequestMethods } from '@/components/lnk-request-methods'
import { LnkRequestRow } from '@/components/lnk-request-row'
import { RequestDialogFooter } from '@/components/request-dialog-footer'
import { RequestDialogHeader } from '@/components/request-dialog-header'
import { RequestNamingControls } from '@/components/request-naming-controls'
import { RequestRowsSearch } from '@/components/request-rows-search'
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
      <div className="flex max-h-[92vh] w-full max-w-[1320px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
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
            <Button
              variant="outline"
              onClick={onOpenRequestManager}
              disabled={requestManagerOptions.length === 0}
              className="shrink-0 border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <Pencil className="mr-2 h-4 w-4" />
              Управление заявками
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-6 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <LnkRequestMethods
            selectedMethodKeys={selectedMethodKeys}
            selectedMethods={selectedMethods}
            onToggleMethod={onToggleMethod}
          />

          <section className="flex min-h-0 flex-col space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Стыки</h3>
                <p className="text-xs leading-5 text-slate-500">
                  Галочка доступна только там, где есть хотя бы один вид контроля без заявки.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onToggleAllRows}
                disabled={!hasSearch || filteredAvailableRows.length === 0}
                title={!hasSearch ? 'Сначала сузьте список поиском' : undefined}
              >
                {allFilteredRowsSelected ? 'Снять все' : 'Выбрать доступные'}
              </Button>
            </div>

            <RequestRowsSearch
              value={requestSearch}
              placeholder="Линия, спул или стык"
              filteredCount={filteredRows.length}
              availableCount={filteredAvailableRows.length}
              onChange={onRequestSearchChange}
            />

            <div className="min-h-0 overflow-auto rounded-md border border-slate-200">
              {filteredAvailableRows.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500">
                  {lnkRowsCount === 0
                    ? 'Нет стыков для отчета ЛНК.'
                    : filteredRows.length === 0
                      ? 'По фильтру ничего не найдено.'
                      : 'По найденным стыкам нет доступных методов для новой заявки.'}
                </div>
              ) : (
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
              )}
            </div>
          </section>
        </div>

        <RequestDialogFooter
          isPending={isPending}
          isCreateDisabled={selectedTargetCount === 0}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      </div>
    </div>
  )
}
