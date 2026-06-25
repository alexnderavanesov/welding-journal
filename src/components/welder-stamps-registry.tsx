import { useEffect, useState } from 'react'
import { Archive, Check, ChevronDown, Pencil, RotateCcw, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WELDER_STAMP_WELD_TYPE_OPTIONS as welderStampWeldTypeOptions } from '@/lib/report-config'
import { formatWelderStampDiameterRange, formatWelderStampValidity, splitWelderStampWeldTypes } from '@/lib/welder-stamp-format'
import { countWelderStampFilters, createEmptyWelderStampFilters, getWelderStampFormHint, hasWelderStampRangeFilters } from '@/lib/welder-stamp-registry'
import type { WelderStampFilters, WelderStampRecord } from '@/lib/welder-stamp-types'

export function WelderStampsRegistry({
  records,
  archivedRecords,
  draft,
  search,
  filters,
  editingId,
  showArchived,
  onSearchChange,
  onFiltersChange,
  onDraftChange,
  onSave,
  onReset,
  onEdit,
  onArchive,
  onRestore,
  onToggleArchived,
  onDelete,
}: {
  records: WelderStampRecord[]
  archivedRecords: WelderStampRecord[]
  draft: WelderStampRecord
  search: string
  filters: WelderStampFilters
  editingId: number | null
  showArchived: boolean
  onSearchChange: (value: string) => void
  onFiltersChange: (value: WelderStampFilters) => void
  onDraftChange: (field: keyof WelderStampRecord, value: string) => void
  onSave: () => void
  onReset: () => void
  onEdit: (record: WelderStampRecord) => void
  onArchive: (id: number) => void
  onRestore: (id: number) => void
  onToggleArchived: (value: boolean) => void
  onDelete: (id: number) => void
}) {
  const selectedWeldTypes = splitWelderStampWeldTypes(draft.weldType)
  const requiresPermitFields = Boolean(draft.naksStamp.trim())
  const hasRangeFilters = hasWelderStampRangeFilters(filters)
  const activeFilterCount = countWelderStampFilters(search, filters)
  const hasAnyFilters = activeFilterCount > 0
  const [isCreatePanelOpen, setIsCreatePanelOpen] = useState(true)
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false)
  const formHint = getWelderStampFormHint(draft)

  useEffect(() => {
    if (editingId !== null) setIsCreatePanelOpen(true)
  }, [editingId])

  function toggleWeldType(type: (typeof welderStampWeldTypeOptions)[number]) {
    const nextTypes = selectedWeldTypes.includes(type)
      ? selectedWeldTypes.filter((value) => value !== type)
      : [...selectedWeldTypes, type]
    onDraftChange('weldType', nextTypes.join(', '))
  }

  function updateFilter(field: keyof WelderStampFilters, value: string) {
    onFiltersChange({ ...filters, [field]: value })
  }

  return (
    <section className="max-w-[calc(100vw-7rem)] space-y-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Справочник клейм сварщиков</h2>
          <p className="mt-1 text-sm text-slate-500">
            Здесь хранятся клейма НАКС, внутренние клейма и допуски по типу сварки, диаметрам и сроку действия.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50/70">
        <button
          type="button"
          onClick={() => setIsCreatePanelOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">Создание клейм</span>
            {editingId !== null ? (
              <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">редактирование</span>
            ) : null}
          </span>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${isCreatePanelOpen ? 'rotate-180' : ''}`} />
        </button>

        {isCreatePanelOpen ? (
          <div className="border-t border-slate-200 p-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1.5 text-sm font-medium text-slate-700">
                <span>Клеймо НАКС</span>
                <Input
                  value={draft.naksStamp}
                  onChange={(event) => onDraftChange('naksStamp', event.target.value)}
                  maxLength={4}
                  placeholder="A123"
                />
              </label>
              <label className="space-y-1.5 text-sm font-medium text-slate-700">
                <span>Клеймо внутреннее</span>
                <Input value={draft.internalStamp} onChange={(event) => onDraftChange('internalStamp', event.target.value)} placeholder="Например: 45" />
              </label>
              <div className="space-y-1.5 text-sm font-medium text-slate-700">
                <span>Тип сварки</span>
                <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-input bg-white px-2 py-1.5 shadow-sm shadow-slate-200/40">
                  {welderStampWeldTypeOptions.map((type) => {
                    const isSelected = selectedWeldTypes.includes(type)
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => toggleWeldType(type)}
                        className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                          isSelected
                            ? 'border-sky-300 bg-sky-50 text-sky-800'
                            : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white'
                        }`}
                        aria-pressed={isSelected}
                      >
                        {type}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1.5 text-sm font-medium text-slate-700">
                  <span>Диаметр от</span>
                  <Input
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={draft.diameterFrom}
                    onChange={(event) => onDraftChange('diameterFrom', event.target.value)}
                    placeholder="от"
                    required={requiresPermitFields}
                  />
                </label>
                <label className="space-y-1.5 text-sm font-medium text-slate-700">
                  <span>Диаметр до</span>
                  <Input
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={draft.diameterTo}
                    onChange={(event) => onDraftChange('diameterTo', event.target.value)}
                    placeholder="без ограничения"
                    title="Если поле пустое, верхнего ограничения по диаметру нет"
                  />
                </label>
              </div>
              <label className="space-y-1.5 text-sm font-medium text-slate-700">
                <span>Срок действия от</span>
                <Input
                  type="date"
                  value={draft.validFrom}
                  onChange={(event) => onDraftChange('validFrom', event.target.value)}
                  required={requiresPermitFields}
                />
              </label>
              <label className="space-y-1.5 text-sm font-medium text-slate-700">
                <span>Срок действия до</span>
                <Input
                  type="date"
                  value={draft.validTo}
                  onChange={(event) => onDraftChange('validTo', event.target.value)}
                  required={requiresPermitFields}
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div
                className={`rounded-md border px-3 py-2 text-xs leading-5 ${
                  formHint.kind === 'error'
                    ? 'border-rose-200 bg-rose-50 text-rose-700'
                    : 'border-sky-100 bg-sky-50 text-sky-800'
                }`}
              >
                {formHint.text}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={onReset}>
                  <X className="mr-2 h-4 w-4" />
                  Очистить
                </Button>
                <Button type="button" onClick={onSave}>
                  <Check className="mr-2 h-4 w-4" />
                  {editingId === null ? 'Добавить клеймо' : 'Сохранить клеймо'}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setIsFilterPanelOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">Фильтры и поиск</span>
            {hasAnyFilters ? (
              <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">
                Активно: {activeFilterCount}
              </span>
            ) : (
              <span className="text-xs font-medium text-slate-500">Не применены</span>
            )}
          </span>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${isFilterPanelOpen ? 'rotate-180' : ''}`} />
        </button>

        {isFilterPanelOpen ? (
          <div className="grid items-end gap-3 bg-white p-4 xl:grid-cols-[minmax(280px,1.4fr)_minmax(110px,0.55fr)_minmax(110px,0.55fr)_minmax(150px,0.7fr)_minmax(150px,0.7fr)_auto]">
            <label className="space-y-1.5 text-sm font-medium text-slate-700">
              <span>Поиск</span>
              <Input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Клеймо НАКС, внутреннее клеймо, тип сварки или диаметр"
                className="h-10"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-slate-700">
              <span>Диаметр от</span>
              <Input
                type="number"
                min="0"
                inputMode="decimal"
                value={filters.diameterFrom}
                onChange={(event) => updateFilter('diameterFrom', event.target.value)}
                placeholder="от"
                className="h-10"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-slate-700">
              <span>Диаметр до</span>
              <Input
                type="number"
                min="0"
                inputMode="decimal"
                value={filters.diameterTo}
                onChange={(event) => updateFilter('diameterTo', event.target.value)}
                placeholder="до"
                className="h-10"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-slate-700">
              <span>Срок от</span>
              <Input type="date" value={filters.validFrom} onChange={(event) => updateFilter('validFrom', event.target.value)} className="h-10" />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-slate-700">
              <span>Срок до</span>
              <Input type="date" value={filters.validTo} onChange={(event) => updateFilter('validTo', event.target.value)} className="h-10" />
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onSearchChange('')
                onFiltersChange(createEmptyWelderStampFilters())
              }}
              disabled={!hasAnyFilters}
              className="h-10 whitespace-nowrap"
            >
              <X className="mr-2 h-4 w-4" />
              Сбросить
            </Button>
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-md border border-slate-200">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead className="bg-slate-100 text-center text-slate-700">
            <tr>
              <th className="border-r border-white px-3 py-3 font-semibold">Клеймо НАКС</th>
              <th className="border-r border-white px-3 py-3 font-semibold">Клеймо внутреннее</th>
              <th className="border-r border-white px-3 py-3 font-semibold">Тип сварки</th>
              <th className="border-r border-white px-3 py-3 font-semibold">Диапазон диаметра</th>
              <th className="border-r border-white px-3 py-3 font-semibold">Срок действия</th>
              <th className="w-32 px-3 py-3 font-semibold">Действия</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  {search.trim() || hasRangeFilters ? 'По фильтрам клейма не найдены.' : 'Пока нет добавленных клейм.'}
                </td>
              </tr>
            ) : (
              records.map((record) => (
                <tr key={record.id} className={record.id === editingId ? 'bg-sky-50' : 'odd:bg-white even:bg-slate-50/60'}>
                  <td className="border-t border-slate-200 px-3 py-3 text-center font-semibold text-slate-900">{record.naksStamp || '-'}</td>
                  <td className="border-t border-slate-200 px-3 py-3 text-center text-slate-700">{record.internalStamp || '-'}</td>
                  <td className="border-t border-slate-200 px-3 py-3 text-center text-slate-700">{record.weldType || '-'}</td>
                  <td className="border-t border-slate-200 px-3 py-3 text-center text-slate-700">{formatWelderStampDiameterRange(record)}</td>
                  <td className="border-t border-slate-200 px-3 py-3 text-center text-slate-700">{formatWelderStampValidity(record)}</td>
                  <td className="border-t border-slate-200 px-3 py-2">
                    <div className="flex justify-center gap-1.5">
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => onEdit(record)} title="Редактировать клеймо">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        onClick={() => onArchive(record.id)}
                        title="Добавить в архив"
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 border-rose-200 text-rose-700 hover:bg-rose-50"
                        onClick={() => onDelete(record.id)}
                        title="Удалить клеймо"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50/60">
        <button
          type="button"
          onClick={() => onToggleArchived(!showArchived)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100"
        >
          <span>Архив клейм</span>
          <span className="flex items-center gap-2 text-xs font-medium text-slate-500">
            {archivedRecords.length} записей
            <ChevronDown className={`h-4 w-4 transition-transform ${showArchived ? 'rotate-180' : ''}`} />
          </span>
        </button>
        {showArchived ? (
          <div className="border-t border-slate-200 bg-white p-3">
            {archivedRecords.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                {search.trim() || hasRangeFilters ? 'По фильтрам архивных клейм не найдено.' : 'Архив пока пуст.'}
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-slate-200">
                <table className="w-full min-w-[980px] border-collapse text-sm">
                  <thead className="bg-slate-100 text-center text-slate-700">
                    <tr>
                      <th className="border-r border-white px-3 py-3 font-semibold">Клеймо НАКС</th>
                      <th className="border-r border-white px-3 py-3 font-semibold">Клеймо внутреннее</th>
                      <th className="border-r border-white px-3 py-3 font-semibold">Тип сварки</th>
                      <th className="border-r border-white px-3 py-3 font-semibold">Диапазон диаметра</th>
                      <th className="border-r border-white px-3 py-3 font-semibold">Срок действия</th>
                      <th className="w-40 px-3 py-3 font-semibold">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {archivedRecords.map((record) => (
                      <tr key={record.id} className="bg-slate-50 text-slate-500">
                        <td className="border-t border-slate-200 px-3 py-3 text-center font-semibold">{record.naksStamp || '-'}</td>
                        <td className="border-t border-slate-200 px-3 py-3 text-center">{record.internalStamp || '-'}</td>
                        <td className="border-t border-slate-200 px-3 py-3 text-center">{record.weldType || '-'}</td>
                        <td className="border-t border-slate-200 px-3 py-3 text-center">{formatWelderStampDiameterRange(record)}</td>
                        <td className="border-t border-slate-200 px-3 py-3 text-center">{formatWelderStampValidity(record)}</td>
                        <td className="border-t border-slate-200 px-3 py-2">
                          <div className="flex justify-center gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8 border-sky-200 text-sky-700 hover:bg-sky-50"
                              onClick={() => onRestore(record.id)}
                              title="Вернуть в общий список"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8 border-rose-200 text-rose-700 hover:bg-rose-50"
                              onClick={() => onDelete(record.id)}
                              title="Удалить клеймо"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}

