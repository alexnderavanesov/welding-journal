import { Check, Pencil, X } from 'lucide-react'

import {
  JointProjectSubtitleMeta,
  JointSpoolDiameterMeta,
  JointWeldDateMeta,
  MetaSeparator,
  OfficialityBadge,
} from '@/components/joint-meta'
import { RequestNamingControls } from '@/components/request-naming-controls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointStatusBadgeClass, getJointStatusLabel } from '@/lib/lnk-status'
import { getPstoResultBadgeClass, getPstoResultLabel } from '@/lib/report-badges'
import { getJointTitle } from '@/lib/report-ui-state'
import type { RequestNamingState } from '@/lib/request-naming-state'

type PstoRequestDialogProps = {
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
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Создание заявки ПСТО</h2>
            <p className="text-sm text-muted-foreground">
              {nextRequestName} · Стыков: {selectedRows.length}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={onOpenRequestManager}
              disabled={requestManagerOptions.length === 0}
              className="border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <Pencil className="mr-2 h-4 w-4" />
              Управление заявками
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="border-b border-slate-100 px-5 py-4">
          <RequestNamingControls
            naming={requestNaming}
            systemName={nextRequestName}
            label="Наименование заявки ПСТО"
            onChange={onRequestNamingChange}
          />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-6 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
            <h3 className="text-sm font-semibold text-slate-800">Термообработка</h3>
            <p className="text-xs leading-5 text-slate-500">
              В заявку можно добавить один или несколько стыков, где ПСТО требуется и заявка еще не создана.
            </p>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
              После создания наименование заявки попадет в столбец «Заявка ПСТО», а строка обновит дату «Внесен ПСТО».
            </div>
          </section>

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

            <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
              <Input
                value={requestSearch}
                onChange={(event) => onRequestSearchChange(event.target.value)}
                placeholder="Проект, шифр, линия, спул или стык"
                className="h-9 min-w-64 flex-1 bg-white"
              />
              <span className="whitespace-nowrap px-2 text-xs text-slate-500">
                Найдено: {filteredRows.length} · Доступно: {availableRowsCount}
              </span>
              {requestSearch ? (
                <Button variant="outline" size="sm" onClick={() => onRequestSearchChange('')}>
                  Очистить
                </Button>
              ) : null}
            </div>

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
                      <label
                        key={row.id}
                        className={`grid grid-cols-[28px_minmax(220px,1fr)_minmax(180px,0.8fr)] items-center gap-3 px-4 py-3 text-sm transition-colors ${
                          disabled
                            ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                            : selected
                              ? 'cursor-pointer bg-sky-50/80'
                              : 'cursor-pointer bg-white hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => onToggleRow(row.id)}
                          disabled={disabled}
                          className="h-4 w-4 rounded border-slate-300 text-slate-900"
                        />
                        <span className="min-w-0">
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="truncate font-medium text-slate-900">{getJointTitle(row)}</span>
                            <OfficialityBadge row={row} compact />
                          </span>
                          <span className="block text-xs leading-5 text-slate-500">
                            <JointProjectSubtitleMeta row={row} />
                            <MetaSeparator />
                            <JointSpoolDiameterMeta row={row} />
                            <MetaSeparator />
                            <JointWeldDateMeta row={row} />
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                            <span className={`rounded border px-1.5 py-0.5 font-semibold ${getJointStatusBadgeClass(row)}`}>
                              Стык: {getJointStatusLabel(row)}
                            </span>
                            <span className={`rounded border px-1.5 py-0.5 font-semibold ${getPstoResultBadgeClass(row.pstoResult)}`}>
                              ПСТО: {getPstoResultLabel(row.pstoResult)}
                            </span>
                          </span>
                        </span>
                        <span className="flex flex-wrap gap-1.5">
                          {disabled ? (
                            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
                              {String(row.pstoRequest ?? '').trim() || 'Заявка уже создана'}
                            </span>
                          ) : (
                            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600">
                              ПСТО
                            </span>
                          )}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={onSubmit} disabled={isPending || selectedRows.length === 0}>
            <Check className="mr-2 h-4 w-4" />
            Создать заявку
          </Button>
        </div>
      </div>
    </div>
  )
}
