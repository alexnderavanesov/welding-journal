import { ChevronDown } from 'lucide-react'
import { WelderStampsRecordsTable } from '@/components/welder-stamps-records-table'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type WelderStampsArchivePanelProps = {
  archivedRecords: WelderStampRecord[]
  showArchived: boolean
  hasSearchOrRangeFilters: boolean
  onRestore: (id: number) => void
  onToggleArchived: (value: boolean) => void
  onDelete: (id: number) => void
}

export function WelderStampsArchivePanel({
  archivedRecords,
  showArchived,
  hasSearchOrRangeFilters,
  onRestore,
  onToggleArchived,
  onDelete,
}: WelderStampsArchivePanelProps) {
  return (
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
              {hasSearchOrRangeFilters ? 'По фильтрам архивных клейм не найдено.' : 'Архив пока пуст.'}
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
  )
}
