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
      className="sticky z-20 flex min-h-8 items-center bg-[#f4f7f9]/95 text-sm text-muted-foreground backdrop-blur-sm"
      style={{ left, width: `calc(100vw - ${left + 24}px)` }}
    >
      <span className="min-w-0 truncate">{summaryText}</span>
    </div>
  )
}
