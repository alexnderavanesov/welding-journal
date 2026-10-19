import { useMemo } from 'react'

import {
  buildLnkCurrentReport,
  buildLnkConclusionsReport,
  buildLnkToRequestReport,
  buildLnkWaitingNkReport,
  buildPstoResultsReport,
  buildPstoCurrentReport,
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
import type { WeldField, WeldInput } from '@/lib/weld-fields'
import { useReportPreview } from '@/lib/use-report-preview'
import type { ReportPreviewContent } from '@/lib/tabular-report'
import type { AgGridWeldReport } from '@/lib/weld-report-grid-profile'
import type { WeldReportExportFieldsRef } from '@/lib/weld-report-export-fields'

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
  outputContext?: string
  currentRowsReady?: boolean
  reportExportFieldsRef: WeldReportExportFieldsRef
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
  outputContext,
  currentRowsReady = true,
  reportExportFieldsRef,
  loadLnkRows,
  loadPstoRows,
  loadWeldingJournalRows,
  setIsLnkShowMenuOpen,
  setIsPstoShowMenuOpen,
  setIsWeldingJournalShowMenuOpen,
  setMessage,
}: UseReportOutputActionsParams) {
  const { open, previewProps } = useReportPreview(outputContext ?? activeReport)
  const actions = useMemo(() => {
    function canOpenCurrentReport() {
      if (currentRowsReady) return true
      setMessage('Дождитесь загрузки строк текущей выборки.')
      return false
    }
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
      if (!canOpenCurrentReport()) return
      const fields = currentGridFields('lnk')
      if (!fields) return
      setIsLnkShowMenuOpen(false)
      await openLoadedReport(
        'ЛНК',
        () => loadLnkRows('current'),
        (rows) => buildLnkCurrentReport(rows, fields),
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
      if (!canOpenCurrentReport()) return
      const fields = currentGridFields('heatTreatment')
      if (!fields) return
      setIsPstoShowMenuOpen(false)
      await openLoadedReport(
        'ПСТО и ТВМТ',
        () => loadPstoRows('current'),
        (rows) => buildPstoCurrentReport(rows, fields),
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

    function currentGridFields(report: AgGridWeldReport): WeldField[] | null {
      const fields = reportExportFieldsRef.current?.(report)
      if (!fields) {
        setMessage('Дождитесь загрузки столбцов текущего отчёта.')
        return null
      }
      if (!fields.length) {
        setMessage('В текущем виде нет столбцов для отчёта. Выберите поля в «Настроить вид → Столбцы».')
        return null
      }
      return fields
    }

    async function openWeldingJournalCurrentReport() {
      if (!canOpenCurrentReport()) return
      const fields = currentGridFields('weldingJournal')
      if (!fields) return
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport(
        'сварочного журнала',
        () => loadWeldingJournalRows('current'),
        (rows) => buildWeldingJournalCurrentReport(
          rows,
          fields,
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
    currentRowsReady,
    reportExportFieldsRef,
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
