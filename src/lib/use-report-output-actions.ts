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
import { useControlProcessSettings } from '@/lib/control-process-settings'
import { reserveTabularReportWindow } from '@/lib/report-window'

export type LnkOutputRowsKind = 'current' | 'waitingNk' | 'waitingRequest' | 'conclusions'
export type PstoOutputRowsKind = 'current' | 'waitingRequest' | 'results'
export type WeldingJournalOutputRowsKind =
  | 'current'
  | 'waitingWeld'
  | 'waitingRequest'
  | 'waitingControl'
  | 'waitingRepair'
  | 'cancelledAccepted'
  | 'system'

type UseReportOutputActionsParams = {
  activeReport: ActiveReport
  activeTitle: string
  loadLnkRows: (kind: LnkOutputRowsKind) => Promise<ReportRow[]>
  loadPstoRows: (kind: PstoOutputRowsKind) => Promise<ReportRow[]>
  loadWeldingJournalRows: (kind: WeldingJournalOutputRowsKind) => Promise<WeldInput[]>
  setIsLnkShowMenuOpen: (value: boolean) => void
  setIsPstoShowMenuOpen: (value: boolean) => void
  setIsWeldingJournalShowMenuOpen: (value: boolean) => void
  setMessage: (message: string | null) => void
}

export function useReportOutputActions({
  activeReport,
  activeTitle,
  loadLnkRows,
  loadPstoRows,
  loadWeldingJournalRows,
  setIsLnkShowMenuOpen,
  setIsPstoShowMenuOpen,
  setIsWeldingJournalShowMenuOpen,
  setMessage,
}: UseReportOutputActionsParams) {
  const controlProcessSettings = useControlProcessSettings()
  return useMemo(() => {
    async function openLoadedReport<Row>(
      reportLabel: string,
      loadRows: () => Promise<Row[]>,
      showRows: (rows: Row[], targetWindow: Window) => Promise<{ ok: true } | { ok: false; message: string }>,
    ) {
      const targetWindow = reserveTabularReportWindow(reportLabel)
      if (!targetWindow) {
        setMessage('Браузер заблокировал открытие новой вкладки')
        return
      }
      setMessage(`Загружаем данные отчета ${reportLabel}…`)
      try {
        const rows = await loadRows()
        const result = await showRows(rows, targetWindow)
        setMessage(result.ok ? null : result.message)
      } catch (error) {
        targetWindow.close()
        setMessage(error instanceof Error ? error.message : `Не удалось загрузить данные отчета ${reportLabel}.`)
      }
    }

    async function openLnkCurrentReport() {
      setIsLnkShowMenuOpen(false)
      await openLoadedReport(
        'ЛНК',
        () => loadLnkRows('current'),
        (rows, targetWindow) => openCurrentReportWindow(
          rows,
          getReportExportOptions(activeReport, activeTitle, controlProcessSettings).fields,
          'ЛНК: текущая версия',
          getReportExportFilename(activeReport),
          targetWindow,
        ),
      )
    }

    async function openLnkWaitingNkReport() {
      setIsLnkShowMenuOpen(false)
      await openLoadedReport('ЛНК «Ожидание НК»', () => loadLnkRows('waitingNk'), openLnkWaitingNkReportWindow)
    }

    async function openLnkToRequestReport() {
      setIsLnkShowMenuOpen(false)
      await openLoadedReport('ЛНК «Ожидание заявки»', () => loadLnkRows('waitingRequest'), openLnkToRequestReportWindow)
    }

    async function openLnkConclusionsReport() {
      setIsLnkShowMenuOpen(false)
      await openLoadedReport('ЛНК «Заключения»', () => loadLnkRows('conclusions'), openLnkConclusionsReportWindow)
    }

    async function openPstoCurrentReport() {
      setIsPstoShowMenuOpen(false)
      await openLoadedReport(
        'ПСТО и ТВМТ',
        () => loadPstoRows('current'),
        (rows, targetWindow) => openCurrentReportWindow(
          rows,
          getReportExportOptions(activeReport, activeTitle, controlProcessSettings).fields,
          'ПСТО и ТВМТ: текущая версия',
          getReportExportFilename(activeReport),
          targetWindow,
        ),
      )
    }

    async function openPstoWaitingRequestReport() {
      setIsPstoShowMenuOpen(false)
      await openLoadedReport('ПСТО «Ожидание заявки»', () => loadPstoRows('waitingRequest'), openPstoWaitingRequestReportWindow)
    }

    async function openPstoResultsReport() {
      setIsPstoShowMenuOpen(false)
      await openLoadedReport('ПСТО «Результаты»', () => loadPstoRows('results'), openPstoResultsReportWindow)
    }

    async function openWeldingJournalCurrentReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport(
        'сварочного журнала',
        () => loadWeldingJournalRows('current'),
        (rows, targetWindow) => openWeldingJournalCurrentReportWindow(
          rows,
          getReportExportOptions(activeReport, activeTitle, controlProcessSettings).fields,
          targetWindow,
        ),
      )
    }

    async function openWeldingJournalWaitingWeldReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('«Ожидает сварку»', () => loadWeldingJournalRows('waitingWeld'), openWeldingJournalWaitingWeldReportWindow)
    }

    async function openWeldingJournalWaitingRequestReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('«Ожидание заявки»', () => loadWeldingJournalRows('waitingRequest'), openWeldingJournalWaitingRequestReportWindow)
    }

    async function openWeldingJournalWaitingControlReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('«Ожидание НК»', () => loadWeldingJournalRows('waitingControl'), openWeldingJournalWaitingControlReportWindow)
    }

    async function openWeldingJournalWaitingRepairReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('«Ожидает ремонт»', () => loadWeldingJournalRows('waitingRepair'), openWeldingJournalWaitingRepairReportWindow)
    }

    async function openWeldingJournalCancelledAcceptedReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('«Отмененные годные»', () => loadWeldingJournalRows('cancelledAccepted'), openWeldingJournalCancelledAcceptedReportWindow)
    }

    async function openWeldingJournalSystemReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('системной версии сварочного журнала', () => loadWeldingJournalRows('system'), openWeldingJournalSystemReportWindow)
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
    controlProcessSettings,
    loadLnkRows,
    loadPstoRows,
    loadWeldingJournalRows,
    setIsLnkShowMenuOpen,
    setIsPstoShowMenuOpen,
    setIsWeldingJournalShowMenuOpen,
    setMessage,
  ])
}
