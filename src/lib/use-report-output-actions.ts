import { useMemo } from 'react'

import { getReportExportFilename, getReportExportOptions } from '@/lib/report-ui-state'
import {
  buildCurrentReport,
  buildLnkConclusionsReport,
  buildLnkToRequestReport,
  buildLnkWaitingNkReport,
  buildPstoResultsReport,
  buildPstoWaitingRequestReport,
  buildWeldingJournalCancelledAcceptedReport,
  buildWeldingJournalCurrentReport,
  buildWeldingJournalSystemReport,
  buildWeldingJournalWaitingControlReport,
  buildWeldingJournalWaitingRepairReport,
  buildWeldingJournalWaitingRequestReport,
  buildWeldingJournalWaitingWeldReport,
} from '@/lib/report-show-builders'
import type { ReportRow } from '@/lib/report-row-actions'
import type { ActiveReport } from '@/lib/home-state'
import type { WeldInput } from '@/lib/weld-fields'
import { useControlProcessSettings } from '@/lib/control-process-settings'
import { useReportPreview } from '@/lib/use-report-preview'
import type { ReportPreviewContent } from '@/lib/tabular-report'

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
  const { open, previewProps } = useReportPreview(activeReport)
  const actions = useMemo(() => {
    async function openLoadedReport<Row>(
      reportLabel: string,
      loadRows: () => Promise<Row[]>,
      showRows: (rows: Row[]) => ReportPreviewContent,
    ) {
      setMessage(null)
      await open(async () => {
        try { return showRows(await loadRows()) }
        catch (error) { throw error instanceof Error ? error : new Error(`Не удалось загрузить данные отчёта ${reportLabel}.`) }
      })
    }

    async function openLnkCurrentReport() {
      setIsLnkShowMenuOpen(false)
      await openLoadedReport(
        'ЛНК',
        () => loadLnkRows('current'),
        (rows) => buildCurrentReport(
          rows,
          getReportExportOptions(activeReport, activeTitle, controlProcessSettings).fields,
          'ЛНК: текущая версия',
          getReportExportFilename(activeReport),
        ),
      )
    }

    async function openLnkWaitingNkReport() {
      setIsLnkShowMenuOpen(false)
      await openLoadedReport('ЛНК «Ожидание НК»', () => loadLnkRows('waitingNk'), buildLnkWaitingNkReport)
    }

    async function openLnkToRequestReport() {
      setIsLnkShowMenuOpen(false)
      await openLoadedReport('ЛНК «Ожидание заявки»', () => loadLnkRows('waitingRequest'), buildLnkToRequestReport)
    }

    async function openLnkConclusionsReport() {
      setIsLnkShowMenuOpen(false)
      await openLoadedReport('ЛНК «Заключения»', () => loadLnkRows('conclusions'), buildLnkConclusionsReport)
    }

    async function openPstoCurrentReport() {
      setIsPstoShowMenuOpen(false)
      await openLoadedReport(
        'ПСТО и ТВМТ',
        () => loadPstoRows('current'),
        (rows) => buildCurrentReport(
          rows,
          getReportExportOptions(activeReport, activeTitle, controlProcessSettings).fields,
          'ПСТО и ТВМТ: текущая версия',
          getReportExportFilename(activeReport),
        ),
      )
    }

    async function openPstoWaitingRequestReport() {
      setIsPstoShowMenuOpen(false)
      await openLoadedReport('ПСТО «Ожидание заявки»', () => loadPstoRows('waitingRequest'), buildPstoWaitingRequestReport)
    }

    async function openPstoResultsReport() {
      setIsPstoShowMenuOpen(false)
      await openLoadedReport('ПСТО «Результаты»', () => loadPstoRows('results'), buildPstoResultsReport)
    }

    async function openWeldingJournalCurrentReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport(
        'сварочного журнала',
        () => loadWeldingJournalRows('current'),
        (rows) => buildWeldingJournalCurrentReport(
          rows,
          getReportExportOptions(activeReport, activeTitle, controlProcessSettings).fields,
        ),
      )
    }

    async function openWeldingJournalWaitingWeldReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('«Ожидает сварку»', () => loadWeldingJournalRows('waitingWeld'), buildWeldingJournalWaitingWeldReport)
    }

    async function openWeldingJournalWaitingRequestReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('«Ожидание заявки»', () => loadWeldingJournalRows('waitingRequest'), buildWeldingJournalWaitingRequestReport)
    }

    async function openWeldingJournalWaitingControlReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('«Ожидание НК»', () => loadWeldingJournalRows('waitingControl'), buildWeldingJournalWaitingControlReport)
    }

    async function openWeldingJournalWaitingRepairReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('«Ожидает ремонт»', () => loadWeldingJournalRows('waitingRepair'), buildWeldingJournalWaitingRepairReport)
    }

    async function openWeldingJournalCancelledAcceptedReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('«Отмененные годные»', () => loadWeldingJournalRows('cancelledAccepted'), buildWeldingJournalCancelledAcceptedReport)
    }

    async function openWeldingJournalSystemReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('системной версии сварочного журнала', () => loadWeldingJournalRows('system'), buildWeldingJournalSystemReport)
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
    open,
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
  return { ...actions, reportPreviewProps: previewProps }
}
