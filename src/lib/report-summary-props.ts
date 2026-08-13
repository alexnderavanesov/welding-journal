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
  weldingRowCount?: number
  acceptedWdiTotal: number
  heatTreatmentRows: WeldRow[]
  heatTreatmentRowCount?: number
  selectedHeatTreatmentRows: WeldRow[]
  lnkRows: WeldRow[]
  lnkRowCount?: number
  availableLnkRequestRows: WeldRow[]
  availableLnkRequestRowCount?: number
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
  weldingRowCount,
  acceptedWdiTotal,
  heatTreatmentRows,
  heatTreatmentRowCount,
  selectedHeatTreatmentRows,
  lnkRows,
  lnkRowCount,
  availableLnkRequestRows,
  availableLnkRequestRowCount,
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
    weldingRowCount: weldingRowCount ?? weldingRows.length,
    acceptedWdiTotalText: formatWdiTotal(acceptedWdiTotal),
    heatTreatmentRowCount: heatTreatmentRowCount ?? heatTreatmentRows.length,
    selectedHeatTreatmentRowCount: selectedHeatTreatmentRows.length,
    lnkRowCount: lnkRowCount ?? lnkRows.length,
    availableLnkRequestRowCount: availableLnkRequestRowCount ?? availableLnkRequestRows.length,
    activeWelderStampCount: welderStamps.filter((record) => !record.archived).length,
    archivedWelderStampCount: welderStamps.filter((record) => record.archived).length,
    filteredWelderStampCount: filteredWelderStamps.length,
    errorMessage,
    message: message ?? undefined,
    messageVariant,
    lnkNotice: lnkNotice ?? undefined,
  }
}
