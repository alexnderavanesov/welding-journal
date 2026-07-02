import { useMemo } from 'react'

import { getReportExportFilename, getReportExportOptions } from '@/lib/report-ui-state'
import {
  openCurrentReportWindow,
  openLnkConclusionsReportWindow,
  openLnkToRequestReportWindow,
  openLnkWaitingNkReportWindow,
  openPstoResultsReportWindow,
  openPstoWaitingRequestReportWindow,
  openWeldingJournalCancelledAcceptedReportWindow,
  openWeldingJournalCurrentReportWindow,
  openWeldingJournalSystemReportWindow,
  openWeldingJournalWaitingControlReportWindow,
  openWeldingJournalWaitingRepairReportWindow,
  openWeldingJournalWaitingRequestReportWindow,
  openWeldingJournalWaitingWeldReportWindow,
} from '@/lib/report-show-windows'
import type { ReportRow } from '@/lib/report-row-actions'
import type { ActiveReport } from '@/lib/home-state'
import type { WeldInput } from '@/lib/weld-fields'

type UseReportOutputActionsParams = {
  activeReport: ActiveReport
  activeTitle: string
  heatTreatmentRows: ReportRow[]
  lnkRows: ReportRow[]
  setIsLnkShowMenuOpen: (value: boolean) => void
  setIsPstoShowMenuOpen: (value: boolean) => void
  setIsWeldingJournalShowMenuOpen: (value: boolean) => void
  setMessage: (message: string | null) => void
  weldingJournalRows: WeldInput[]
  visibleRows: WeldInput[]
}

export function useReportOutputActions({
  activeReport,
  activeTitle,
  heatTreatmentRows,
  lnkRows,
  setIsLnkShowMenuOpen,
  setIsPstoShowMenuOpen,
  setIsWeldingJournalShowMenuOpen,
  setMessage,
  weldingJournalRows,
  visibleRows,
}: UseReportOutputActionsParams) {
  return useMemo(() => {
    function openLnkCurrentReport() {
      setIsLnkShowMenuOpen(false)
      const result = openCurrentReportWindow(
        visibleRows,
        getReportExportOptions(activeReport, activeTitle).fields,
        'ЛНК: текущая версия',
        getReportExportFilename(activeReport),
      )
      if (!result.ok) setMessage(result.message)
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

    function openPstoCurrentReport() {
      setIsPstoShowMenuOpen(false)
      const result = openCurrentReportWindow(
        visibleRows,
        getReportExportOptions(activeReport, activeTitle).fields,
        'Термообработка: текущая версия',
        getReportExportFilename(activeReport),
      )
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

    function openWeldingJournalCurrentReport() {
      setIsWeldingJournalShowMenuOpen(false)
      const result = openWeldingJournalCurrentReportWindow(
        visibleRows,
        getReportExportOptions(activeReport, activeTitle).fields,
      )
      if (!result.ok) setMessage(result.message)
    }

    function openWeldingJournalWaitingWeldReport() {
      setIsWeldingJournalShowMenuOpen(false)
      const result = openWeldingJournalWaitingWeldReportWindow(weldingJournalRows)
      if (!result.ok) setMessage(result.message)
    }

    function openWeldingJournalWaitingRequestReport() {
      setIsWeldingJournalShowMenuOpen(false)
      const result = openWeldingJournalWaitingRequestReportWindow(weldingJournalRows)
      if (!result.ok) setMessage(result.message)
    }

    function openWeldingJournalWaitingControlReport() {
      setIsWeldingJournalShowMenuOpen(false)
      const result = openWeldingJournalWaitingControlReportWindow(weldingJournalRows)
      if (!result.ok) setMessage(result.message)
    }

    function openWeldingJournalWaitingRepairReport() {
      setIsWeldingJournalShowMenuOpen(false)
      const result = openWeldingJournalWaitingRepairReportWindow(weldingJournalRows)
      if (!result.ok) setMessage(result.message)
    }

    function openWeldingJournalCancelledAcceptedReport() {
      setIsWeldingJournalShowMenuOpen(false)
      const result = openWeldingJournalCancelledAcceptedReportWindow(weldingJournalRows)
      if (!result.ok) setMessage(result.message)
    }

    function openWeldingJournalSystemReport() {
      setIsWeldingJournalShowMenuOpen(false)
      const result = openWeldingJournalSystemReportWindow(weldingJournalRows)
      if (!result.ok) setMessage(result.message)
    }

    return {
      openLnkConclusionsReport,
      openLnkCurrentReport,
      openLnkToRequestReport,
      openLnkWaitingNkReport,
      openPstoCurrentReport,
      openPstoResultsReport,
      openPstoWaitingRequestReport,
      openWeldingJournalCancelledAcceptedReport,
      openWeldingJournalCurrentReport,
      openWeldingJournalSystemReport,
      openWeldingJournalWaitingControlReport,
      openWeldingJournalWaitingRepairReport,
      openWeldingJournalWaitingRequestReport,
      openWeldingJournalWaitingWeldReport,
    }
  }, [
    activeReport,
    activeTitle,
    heatTreatmentRows,
    lnkRows,
    setIsLnkShowMenuOpen,
    setIsPstoShowMenuOpen,
    setIsWeldingJournalShowMenuOpen,
    setMessage,
    weldingJournalRows,
    visibleRows,
  ])
}
