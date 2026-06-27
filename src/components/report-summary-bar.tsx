import type { ActiveReport } from '@/lib/home-state'
import { getReportSummaryText } from '@/lib/report-ui-state'

export type ReportSummaryBarProps = {
  activeReport: ActiveReport
  left: number
  minWidth: number
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
  errorMessage?: string | null
  message?: string
}

export function ReportSummaryBar({
  activeReport,
  left,
  minWidth,
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
  errorMessage,
  message,
}: ReportSummaryBarProps) {
  return (
    <div
      className="sticky z-20 flex min-h-6 w-full items-center justify-between bg-white text-sm text-muted-foreground"
      style={{ left, minWidth }}
    >
      <span>
        {getReportSummaryText({
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
        })}
        {errorMessage ? ` Ошибка: ${errorMessage}` : null}
      </span>
      <span>{message}</span>
    </div>
  )
}
