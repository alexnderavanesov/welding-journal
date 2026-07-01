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
  messageVariant?: 'lnk-success'
  lnkNotice?: string
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
  messageVariant,
  lnkNotice,
}: ReportSummaryBarProps) {
  const messageClassName =
    messageVariant === 'lnk-success'
      ? 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800 shadow-sm'
      : ''
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
  const showLnkNotice = activeReport === 'lnk' && Boolean(lnkNotice)
  const showRightMessage = message && !showLnkNotice

  return (
    <div
      className="sticky z-20 flex min-h-6 w-full items-center justify-between bg-white text-sm text-muted-foreground"
      style={{ left, minWidth }}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1">
        <span>
          {summaryText}
          {errorMessage ? ` Ошибка: ${errorMessage}` : null}
        </span>
        {showLnkNotice ? (
          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800 shadow-sm">
            {lnkNotice}
          </span>
        ) : null}
      </span>
      {showRightMessage ? <span className={messageClassName}>{message}</span> : <span />}
    </div>
  )
}
