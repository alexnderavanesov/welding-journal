import { Search, X } from 'lucide-react'
import type { ActiveReport } from '@/lib/home-state'
import { getReportSummaryText } from '@/lib/report-ui-state'

export type ReportSummaryBarProps = {
  activeReport: ActiveReport
  left: number
  isLoading: boolean
  weldingRowCount: number
  acceptedWdiTotalText: string
  heatTreatmentRowCount: number
  selectedHeatTreatmentRowCount: number
  lnkRowCount: number
  availableLnkRequestRowCount: number
  activeWelderStampCount: number
  archivedWelderStampCount: number
  filteredWelderStampCount: number
  quickSearchValue?: string
  onQuickSearchChange?: (value: string) => void
  embedded?: boolean
}

export function ReportSummaryBar({
  activeReport,
  left,
  isLoading,
  weldingRowCount,
  acceptedWdiTotalText,
  heatTreatmentRowCount,
  selectedHeatTreatmentRowCount,
  lnkRowCount,
  availableLnkRequestRowCount,
  activeWelderStampCount,
  archivedWelderStampCount,
  filteredWelderStampCount,
  quickSearchValue,
  onQuickSearchChange,
  embedded = false,
}: ReportSummaryBarProps) {
  const summaryText = getReportSummaryText({
    activeReport,
    isLoading,
    weldingRowCount,
    acceptedWdiTotalText,
    heatTreatmentRowCount,
    selectedHeatTreatmentRowCount,
    lnkRowCount,
    availableLnkRequestRowCount,
    activeWelderStampCount,
    archivedWelderStampCount,
    filteredWelderStampCount,
  })

  return (
    <div
      className={embedded
        ? 'isolate flex min-h-8 min-w-0 items-center overflow-hidden text-sm leading-5 text-muted-foreground'
        : 'sticky isolate z-20 flex h-8 min-h-8 items-center overflow-hidden bg-[#f4f7f9] text-sm leading-5 text-muted-foreground'}
      style={embedded ? undefined : { left, width: `calc(100vw - ${left + 24}px)` }}
    >
      <span className="block min-w-0 flex-1 truncate leading-5">{summaryText}</span>
      {onQuickSearchChange ? (
        <label className="relative ml-3 block w-[min(18rem,48vw)] shrink-0">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={quickSearchValue ?? ''}
            onChange={(event) => onQuickSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || !quickSearchValue) return
              event.preventDefault()
              event.stopPropagation()
              onQuickSearchChange('')
            }}
            aria-label="Быстрый поиск по отчету"
            placeholder="Поиск по отчету"
            className="h-8 w-full appearance-none rounded-md border border-slate-300 bg-white py-1 pl-7 pr-8 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100 [&::-webkit-search-cancel-button]:hidden"
          />
          {quickSearchValue ? (
            <button
              type="button"
              onClick={() => onQuickSearchChange('')}
              aria-label="Очистить быстрый поиск"
              title="Очистить быстрый поиск"
              className="absolute right-1 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </label>
      ) : null}
    </div>
  )
}
