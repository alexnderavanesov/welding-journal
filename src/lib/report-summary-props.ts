import type { ReportSummaryBarProps } from '@/components/report-summary-bar'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ActiveReport } from '@/lib/home-state'
import { formatWdiTotal } from '@/lib/report-export'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type CreateReportSummaryBarPropsOptions = {
  activeReport: ActiveReport
  left: number
  isLoading: boolean
  weldingRows: WeldRow[]
  weldingRowCount?: number
  acceptedWdiTotal: number
  heatTreatmentRows: WeldRow[]
  heatTreatmentRowCount?: number
  selectedHeatTreatmentRowCount: number
  lnkRows: WeldRow[]
  lnkRowCount?: number
  availableLnkRequestRows: WeldRow[]
  availableLnkRequestRowCount?: number
  welderStamps: WelderStampRecord[]
  filteredWelderStamps: WelderStampRecord[]
  returnContext?: ReportSummaryBarProps['returnContext']
  onReturnContext?: ReportSummaryBarProps['onReturnContext']
  onDismissReturnContext?: ReportSummaryBarProps['onDismissReturnContext']
}

export function createReportSummaryBarProps({
  activeReport,
  left,
  isLoading,
  weldingRows,
  weldingRowCount,
  acceptedWdiTotal,
  heatTreatmentRows,
  heatTreatmentRowCount,
  selectedHeatTreatmentRowCount,
  lnkRows,
  lnkRowCount,
  availableLnkRequestRows,
  availableLnkRequestRowCount,
  welderStamps,
  filteredWelderStamps,
  returnContext,
  onReturnContext,
  onDismissReturnContext,
}: CreateReportSummaryBarPropsOptions): ReportSummaryBarProps {
  return {
    activeReport,
    left,
    isLoading,
    weldingRowCount: weldingRowCount ?? weldingRows.length,
    acceptedWdiTotalText: formatWdiTotal(acceptedWdiTotal),
    heatTreatmentRowCount: heatTreatmentRowCount ?? heatTreatmentRows.length,
    selectedHeatTreatmentRowCount,
    lnkRowCount: lnkRowCount ?? lnkRows.length,
    availableLnkRequestRowCount: availableLnkRequestRowCount ?? availableLnkRequestRows.length,
    activeWelderStampCount: welderStamps.filter((record) => !record.archived).length,
    archivedWelderStampCount: welderStamps.filter((record) => record.archived).length,
    filteredWelderStampCount: filteredWelderStamps.length,
    returnContext,
    onReturnContext,
    onDismissReturnContext,
  }
}
