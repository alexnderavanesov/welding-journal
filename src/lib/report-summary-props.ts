import type { ReportSummaryBarProps } from '@/components/report-summary-bar'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ActiveReport } from '@/lib/home-state'
import { formatWdiTotal } from '@/lib/report-export'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type CreateReportSummaryBarPropsOptions = {
  activeReport: ActiveReport
  left: number
  isLoading: boolean
  summaryStatus?: ReportSummaryBarProps['summaryStatus']
  summaryError?: string
  onRetrySummary?: () => void
  rowsError?: string
  onRetryRows?: () => void
  weldingRows: WeldRow[]
  weldingRowCount?: number
  acceptedWdiTotal: number | undefined
  isAcceptedWdiRecalculating?: boolean
  heatTreatmentRows: WeldRow[]
  heatTreatmentRowCount?: number
  selectedHeatTreatmentRowCount: number
  lnkRows: WeldRow[]
  lnkRowCount?: number
  availableLnkRequestRows: WeldRow[]
  availableLnkRequestRowCount?: number
  welderStamps: WelderStampRecord[]
  filteredWelderStamps: WelderStampRecord[]
}

export function createReportSummaryBarProps({
  activeReport,
  left,
  isLoading,
  summaryStatus,
  summaryError,
  onRetrySummary,
  rowsError,
  onRetryRows,
  weldingRows,
  weldingRowCount,
  acceptedWdiTotal,
  isAcceptedWdiRecalculating = false,
  heatTreatmentRows,
  heatTreatmentRowCount,
  selectedHeatTreatmentRowCount,
  lnkRows,
  lnkRowCount,
  availableLnkRequestRows,
  availableLnkRequestRowCount,
  welderStamps,
  filteredWelderStamps,
}: CreateReportSummaryBarPropsOptions): ReportSummaryBarProps {
  return {
    activeReport,
    left,
    isLoading,
    summaryStatus,
    summaryError,
    onRetrySummary,
    rowsError,
    onRetryRows,
    weldingRowCount: summaryStatus ? weldingRowCount : weldingRowCount ?? weldingRows.length,
    acceptedWdiTotalText: acceptedWdiTotal === undefined
      ? 'Недоступно'
      : `${formatWdiTotal(acceptedWdiTotal)}${isAcceptedWdiRecalculating ? ' (пересчёт)' : ''}`,
    heatTreatmentRowCount: summaryStatus ? heatTreatmentRowCount : heatTreatmentRowCount ?? heatTreatmentRows.length,
    selectedHeatTreatmentRowCount,
    lnkRowCount: summaryStatus ? lnkRowCount : lnkRowCount ?? lnkRows.length,
    availableLnkRequestRowCount: summaryStatus ? availableLnkRequestRowCount : availableLnkRequestRowCount ?? availableLnkRequestRows.length,
    activeWelderStampCount: welderStamps.filter((record) => !record.archived).length,
    archivedWelderStampCount: welderStamps.filter((record) => record.archived).length,
    filteredWelderStampCount: filteredWelderStamps.length,
  }
}
