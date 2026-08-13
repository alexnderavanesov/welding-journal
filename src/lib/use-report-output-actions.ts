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
  isLnkRowsContextReady: boolean
  isPstoRowsContextReady: boolean
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
  isLnkRowsContextReady,
  isPstoRowsContextReady,
  lnkRows,
  setIsLnkShowMenuOpen,
  setIsPstoShowMenuOpen,
  setIsWeldingJournalShowMenuOpen,
  setMessage,
  weldingJournalRows,
  visibleRows,
}: UseReportOutputActionsParams) {
  return useMemo(() => {
    function requireContextReady(ready: boolean, reportLabel: string) {
      if (ready) return true
      setMessage(`Данные отчета ${reportLabel} еще загружаются. Повторите действие через несколько секунд.`)
      return false
    }

    async function openLnkCurrentReport() {
      if (!requireContextReady(isLnkRowsContextReady, 'ЛНК')) return
      setIsLnkShowMenuOpen(false)
      const result = await openCurrentReportWindow(
        visibleRows,
        getReportExportOptions(activeReport, activeTitle).fields,
        'ЛНК: текущая версия',
        getReportExportFilename(activeReport),
      )
      if (!result.ok) setMessage(result.message)
    }

    async function openLnkWaitingNkReport() {
      if (!requireContextReady(isLnkRowsContextReady, 'ЛНК')) return
      setIsLnkShowMenuOpen(false)
      const result = await openLnkWaitingNkReportWindow(lnkRows)
      if (!result.ok) setMessage(result.message)
    }

    async function openLnkToRequestReport() {
      if (!requireContextReady(isLnkRowsContextReady, 'ЛНК')) return
      setIsLnkShowMenuOpen(false)
      const result = await openLnkToRequestReportWindow(lnkRows)
      if (!result.ok) setMessage(result.message)
    }

    async function openLnkConclusionsReport() {
      if (!requireContextReady(isLnkRowsContextReady, 'ЛНК')) return
      setIsLnkShowMenuOpen(false)
      const result = await openLnkConclusionsReportWindow(lnkRows)
      if (!result.ok) setMessage(result.message)
    }

    async function openPstoCurrentReport() {
      if (!requireContextReady(isPstoRowsContextReady, 'ПСТО')) return
      setIsPstoShowMenuOpen(false)
      const result = await openCurrentReportWindow(
        visibleRows,
        getReportExportOptions(activeReport, activeTitle).fields,
        'Термообработка: текущая версия',
        getReportExportFilename(activeReport),
      )
      if (!result.ok) setMessage(result.message)
    }

    async function openPstoWaitingRequestReport() {
      if (!requireContextReady(isPstoRowsContextReady, 'ПСТО')) return
      setIsPstoShowMenuOpen(false)
      const result = await openPstoWaitingRequestReportWindow(heatTreatmentRows)
      if (!result.ok) setMessage(result.message)
    }

    async function openPstoResultsReport() {
      if (!requireContextReady(isPstoRowsContextReady, 'ПСТО')) return
      setIsPstoShowMenuOpen(false)
      const result = await openPstoResultsReportWindow(heatTreatmentRows)
      if (!result.ok) setMessage(result.message)
    }

    async function openWeldingJournalCurrentReport() {
      setIsWeldingJournalShowMenuOpen(false)
      const result = await openWeldingJournalCurrentReportWindow(
        visibleRows,
        getReportExportOptions(activeReport, activeTitle).fields,
      )
      if (!result.ok) setMessage(result.message)
    }

    async function openWeldingJournalWaitingWeldReport() {
      setIsWeldingJournalShowMenuOpen(false)
      const result = await openWeldingJournalWaitingWeldReportWindow(weldingJournalRows)
      if (!result.ok) setMessage(result.message)
    }

    async function openWeldingJournalWaitingRequestReport() {
      setIsWeldingJournalShowMenuOpen(false)
      const result = await openWeldingJournalWaitingRequestReportWindow(weldingJournalRows)
      if (!result.ok) setMessage(result.message)
    }

    async function openWeldingJournalWaitingControlReport() {
      setIsWeldingJournalShowMenuOpen(false)
      const result = await openWeldingJournalWaitingControlReportWindow(weldingJournalRows)
      if (!result.ok) setMessage(result.message)
    }

    async function openWeldingJournalWaitingRepairReport() {
      setIsWeldingJournalShowMenuOpen(false)
      const result = await openWeldingJournalWaitingRepairReportWindow(weldingJournalRows)
      if (!result.ok) setMessage(result.message)
    }

    async function openWeldingJournalCancelledAcceptedReport() {
      setIsWeldingJournalShowMenuOpen(false)
      const result = await openWeldingJournalCancelledAcceptedReportWindow(weldingJournalRows)
      if (!result.ok) setMessage(result.message)
    }

    async function openWeldingJournalSystemReport() {
      setIsWeldingJournalShowMenuOpen(false)
      const result = await openWeldingJournalSystemReportWindow(weldingJournalRows)
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
    isLnkRowsContextReady,
    isPstoRowsContextReady,
    lnkRows,
    setIsLnkShowMenuOpen,
    setIsPstoShowMenuOpen,
    setIsWeldingJournalShowMenuOpen,
    setMessage,
    weldingJournalRows,
    visibleRows,
  ])
}
