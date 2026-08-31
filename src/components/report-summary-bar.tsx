import type { ActiveReport } from '@/lib/home-state'
import { getReportSummaryText } from '@/lib/report-ui-state'
import { ArrowLeft, X } from 'lucide-react'

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
  returnContext?: { title: string } | null
  onReturnContext?: () => void
  onDismissReturnContext?: () => void
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
  returnContext,
  onReturnContext,
  onDismissReturnContext,
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
      className="sticky z-20 flex min-h-8 items-center justify-between gap-3 bg-[#f4f7f9]/95 text-sm text-muted-foreground backdrop-blur-sm"
      style={{ left, width: `calc(100vw - ${left + 24}px)` }}
    >
      <span className="min-w-0 truncate">{summaryText}</span>
      {returnContext && onReturnContext ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2.5 text-xs font-semibold text-sky-800 transition-colors hover:bg-sky-100 hover:text-sky-950"
            onClick={onReturnContext}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Вернуться: {returnContext.title}
          </button>
          {onDismissReturnContext ? (
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              onClick={onDismissReturnContext}
              aria-label="Не сохранять исходный контекст"
              title="Не показывать возврат к исходному отчету"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
