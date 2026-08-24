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
  errorMessage?: string | null
  message?: string
  messageVariant?: 'lnk-success'
  lnkNotice?: string
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
  errorMessage,
  message,
  messageVariant,
  lnkNotice,
}: ReportSummaryBarProps) {
  const messageClassName =
    messageVariant === 'lnk-success'
      ? 'min-w-0 max-w-[60vw] truncate rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800 shadow-sm'
      : 'min-w-0 max-w-[60vw] truncate rounded-md border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-medium text-sky-800 shadow-sm'
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
      className="sticky z-20 flex min-h-6 items-center justify-between gap-3 bg-white text-sm text-muted-foreground"
      style={{ left, width: `calc(100vw - ${left + 24}px)` }}
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
      {showRightMessage ? <span className={messageClassName} title={message}>{message}</span> : <span />}
    </div>
  )
}
