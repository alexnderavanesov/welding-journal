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
      className="sticky isolate z-20 flex h-8 min-h-8 items-center overflow-hidden bg-[#f4f7f9] text-sm leading-5 text-muted-foreground"
      style={{ left, width: `calc(100vw - ${left + 24}px)` }}
    >
      <span className="block min-w-0 truncate leading-5">{summaryText}</span>
    </div>
  )
}
