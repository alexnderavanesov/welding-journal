import { useMemo } from 'react'

import { getReportExportFilename, getReportExportOptions } from '@/lib/report-ui-state'
import { downloadExcelBytes } from '@/lib/report-window'
import {
  openLnkConclusionsReportWindow,
  openLnkToRequestReportWindow,
  openLnkWaitingNkReportWindow,
  openPstoResultsReportWindow,
  openPstoWaitingRequestReportWindow,
} from '@/lib/report-show-windows'
import type { ReportRow } from '@/lib/report-row-actions'
import { buildExportXlsxBytes } from '@/lib/weld-import-export'
import type { ActiveReport } from '@/lib/home-state'
import type { WeldInput } from '@/lib/weld-fields'

type UseReportOutputActionsParams = {
  activeReport: ActiveReport
  activeTitle: string
  heatTreatmentRows: ReportRow[]
  lnkRows: ReportRow[]
  setIsLnkShowMenuOpen: (value: boolean) => void
  setIsPstoShowMenuOpen: (value: boolean) => void
  setMessage: (message: string | null) => void
  visibleRows: WeldInput[]
}

export function useReportOutputActions({
  activeReport,
  activeTitle,
  heatTreatmentRows,
  lnkRows,
  setIsLnkShowMenuOpen,
  setIsPstoShowMenuOpen,
  setMessage,
  visibleRows,
}: UseReportOutputActionsParams) {
  return useMemo(() => {
    function exportXlsx() {
      const bytes = buildExportXlsxBytes(visibleRows, getReportExportOptions(activeReport, activeTitle))
      downloadExcelBytes(bytes, getReportExportFilename(activeReport))
    }

    function openLnkWaitingNkReport() {
      setIsLnkShowMenuOpen(false)
      const result = openLnkWaitingNkReportWindow(lnkRows)
      if (!result.ok) setMessage(result.message)
    }

    function openLnkToRequestReport() {
      setIsLnkShowMenuOpen(false)
      const result = openLnkToRequestReportWindow(lnkRows)
      if (!result.ok) setMessage(result.message)
    }

    function openLnkConclusionsReport() {
      setIsLnkShowMenuOpen(false)
      const result = openLnkConclusionsReportWindow(lnkRows)
      if (!result.ok) setMessage(result.message)
    }

    function openPstoWaitingRequestReport() {
      setIsPstoShowMenuOpen(false)
      const result = openPstoWaitingRequestReportWindow(heatTreatmentRows)
      if (!result.ok) setMessage(result.message)
    }

    function openPstoResultsReport() {
      setIsPstoShowMenuOpen(false)
      const result = openPstoResultsReportWindow(heatTreatmentRows)
      if (!result.ok) setMessage(result.message)
    }

    return {
      exportXlsx,
      openLnkConclusionsReport,
      openLnkToRequestReport,
      openLnkWaitingNkReport,
      openPstoResultsReport,
      openPstoWaitingRequestReport,
    }
  }, [
    activeReport,
    activeTitle,
    heatTreatmentRows,
    lnkRows,
    setIsLnkShowMenuOpen,
    setIsPstoShowMenuOpen,
    setMessage,
    visibleRows,
  ])
}
