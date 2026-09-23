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
    weldingRowCount: weldingRowCount ?? weldingRows.length,
    acceptedWdiTotalText: `${formatWdiTotal(acceptedWdiTotal)}${isAcceptedWdiRecalculating ? ' (пересчёт)' : ''}`,
    heatTreatmentRowCount: heatTreatmentRowCount ?? heatTreatmentRows.length,
    selectedHeatTreatmentRowCount,
    lnkRowCount: lnkRowCount ?? lnkRows.length,
    availableLnkRequestRowCount: availableLnkRequestRowCount ?? availableLnkRequestRows.length,
    activeWelderStampCount: welderStamps.filter((record) => !record.archived).length,
    archivedWelderStampCount: welderStamps.filter((record) => record.archived).length,
    filteredWelderStampCount: filteredWelderStamps.length,
  }
}
