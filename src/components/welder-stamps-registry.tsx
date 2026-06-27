import { ChevronDown } from 'lucide-react'
import { WelderStampsCreatePanel } from '@/components/welder-stamps-create-panel'
import { WelderStampsFiltersPanel } from '@/components/welder-stamps-filters-panel'
import { WelderStampsRecordsTable } from '@/components/welder-stamps-records-table'
import { hasWelderStampRangeFilters } from '@/lib/welder-stamp-registry'
import type { WelderStampFilters, WelderStampRecord } from '@/lib/welder-stamp-types'

export type WelderStampsRegistryProps = {
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
}

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
}: WelderStampsRegistryProps) {
  const hasRangeFilters = hasWelderStampRangeFilters(filters)

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

      <WelderStampsCreatePanel
        draft={draft}
        editingId={editingId}
        onDraftChange={onDraftChange}
        onSave={onSave}
        onReset={onReset}
      />

      <WelderStampsFiltersPanel search={search} filters={filters} onSearchChange={onSearchChange} onFiltersChange={onFiltersChange} />

      <div className="overflow-hidden rounded-md border border-slate-200">
        <WelderStampsRecordsTable
          records={records}
          emptyMessage={search.trim() || hasRangeFilters ? 'По фильтрам клейма не найдены.' : 'Пока нет добавленных клейм.'}
          editingId={editingId}
          onEdit={onEdit}
          onArchive={onArchive}
          onDelete={onDelete}
        />
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
                <WelderStampsRecordsTable
                  records={archivedRecords}
                  emptyMessage=""
                  archived
                  onRestore={onRestore}
                  onDelete={onDelete}
                />
              </div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}
