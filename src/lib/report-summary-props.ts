import type { ReportSummaryBarProps } from '@/components/report-summary-bar'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ActiveReport } from '@/lib/home-state'
import { formatWdiTotal } from '@/lib/report-export'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type CreateReportSummaryBarPropsOptions = {
  activeReport: ActiveReport
  left: number
  minWidth: number
  isLoading: boolean
  weldingRows: WeldRow[]
  acceptedWdiTotal: number
  heatTreatmentRows: WeldRow[]
  selectedHeatTreatmentRows: WeldRow[]
  lnkRows: WeldRow[]
  availableLnkRequestRows: WeldRow[]
  welderStamps: WelderStampRecord[]
  filteredWelderStamps: WelderStampRecord[]
  errorMessage?: string | null
  message?: string | null
  messageVariant?: ReportSummaryBarProps['messageVariant']
  lnkNotice?: string | null
}

export function createReportSummaryBarProps({
  activeReport,
  left,
  minWidth,
  isLoading,
  weldingRows,
  acceptedWdiTotal,
  heatTreatmentRows,
  selectedHeatTreatmentRows,
  lnkRows,
  availableLnkRequestRows,
  welderStamps,
  filteredWelderStamps,
  errorMessage,
  message,
  messageVariant,
  lnkNotice,
}: CreateReportSummaryBarPropsOptions): ReportSummaryBarProps {
  return {
    activeReport,
    left,
    minWidth,
    isLoading,
    weldingRowCount: weldingRows.length,
    acceptedWdiTotalText: formatWdiTotal(acceptedWdiTotal),
    heatTreatmentRowCount: heatTreatmentRows.length,
    selectedHeatTreatmentRowCount: selectedHeatTreatmentRows.length,
    lnkRowCount: lnkRows.length,
    availableLnkRequestRowCount: availableLnkRequestRows.length,
    activeWelderStampCount: welderStamps.filter((record) => !record.archived).length,
    archivedWelderStampCount: welderStamps.filter((record) => record.archived).length,
    filteredWelderStampCount: filteredWelderStamps.length,
    errorMessage,
    message: message ?? undefined,
    messageVariant,
    lnkNotice: lnkNotice ?? undefined,
  }
}
