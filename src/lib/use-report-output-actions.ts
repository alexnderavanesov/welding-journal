import { useMemo } from 'react'

import type { ActiveReport } from '@/lib/home-state'
import type { WeldField } from '@/lib/weld-fields'
import { useReportPreview } from '@/lib/use-report-preview'
import type { AgGridWeldReport } from '@/lib/weld-report-grid-profile'
import type { WeldReportExportFieldsRef } from '@/lib/weld-report-export-fields'
import type { ReportOutputSnapshot } from '@/server/weld-contracts'

type LoadedOutput = ReportOutputSnapshot & { onDownloadExcel?: (signal?: AbortSignal) => Promise<void> }

export type LnkOutputRowsKind = 'current' | 'waitingNk' | 'waitingRequest' | 'conclusions' | 'waitingRepair'
export type PstoOutputRowsKind = 'current' | 'waitingRequest' | 'results'
export type WeldingJournalOutputRowsKind =
  | 'current'
  | 'waitingWeld'
  | 'waitingRequest'
  | 'waitingControl'
  | 'waitingRepair'
  | 'system'

type UseReportOutputActionsParams = {
  activeReport: ActiveReport
  outputContext?: string
  currentRowsReady?: boolean
  reportExportFieldsRef: WeldReportExportFieldsRef
  loadLnkRows: (kind: LnkOutputRowsKind, fields?: WeldField[], signal?: AbortSignal) => Promise<LoadedOutput>
  loadPstoRows: (kind: PstoOutputRowsKind, fields?: WeldField[], signal?: AbortSignal) => Promise<LoadedOutput>
  loadWeldingJournalRows: (kind: WeldingJournalOutputRowsKind, fields?: WeldField[], signal?: AbortSignal) => Promise<LoadedOutput>
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
    async function openLoadedReport(reportLabel: string, loadRows: (signal: AbortSignal) => Promise<LoadedOutput>) {
      setMessage(null)
      await open(async signal => {
        try {
          const snapshot = await loadRows(signal)
          return { report: snapshot.report, onDownloadExcel: snapshot.onDownloadExcel }
        } catch (error) { throw error instanceof Error ? error : new Error(`Не удалось загрузить данные отчёта ${reportLabel}.`) }
      })
    }

    async function openLnkCurrentReport() {
      if (!canOpenCurrentReport()) return
      const fields = currentGridFields('lnk')
      if (!fields) return
      setIsLnkShowMenuOpen(false)
      await openLoadedReport(
        'ЛНК',
        signal => loadLnkRows('current', fields, signal),
      )
    }

    async function openLnkWaitingNkReport() {
      setIsLnkShowMenuOpen(false)
      await openLoadedReport('ЛНК «Ожидание НК»', signal => loadLnkRows('waitingNk', undefined, signal))
    }

    async function openLnkToRequestReport() {
      setIsLnkShowMenuOpen(false)
      await openLoadedReport('ЛНК «Ожидание заявки»', signal => loadLnkRows('waitingRequest', undefined, signal))
    }

    async function openLnkWaitingRepairReport() {
      setIsLnkShowMenuOpen(false)
      await openLoadedReport('ЛНК «Ожидает ремонта»', signal => loadLnkRows('waitingRepair', undefined, signal))
    }

    async function openLnkConclusionsReport() {
      setIsLnkShowMenuOpen(false)
      await openLoadedReport('ЛНК «Заключения»', signal => loadLnkRows('conclusions', undefined, signal))
    }

    async function openPstoCurrentReport() {
      if (!canOpenCurrentReport()) return
      const fields = currentGridFields('heatTreatment')
      if (!fields) return
      setIsPstoShowMenuOpen(false)
      await openLoadedReport(
        'ПСТО и ТВМТ',
        signal => loadPstoRows('current', fields, signal),
      )
    }

    async function openPstoWaitingRequestReport() {
      setIsPstoShowMenuOpen(false)
      await openLoadedReport('ПСТО «Ожидание заявки»', signal => loadPstoRows('waitingRequest', undefined, signal))
    }

    async function openPstoResultsReport() {
      setIsPstoShowMenuOpen(false)
      await openLoadedReport('ПСТО «Результаты»', signal => loadPstoRows('results', undefined, signal))
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
        signal => loadWeldingJournalRows('current', fields, signal),
      )
    }

    async function openWeldingJournalWaitingWeldReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('«Ожидает сварку»', signal => loadWeldingJournalRows('waitingWeld', undefined, signal))
    }

    async function openWeldingJournalWaitingRequestReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('«Ожидание заявки»', signal => loadWeldingJournalRows('waitingRequest', undefined, signal))
    }

    async function openWeldingJournalWaitingControlReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('«Ожидание НК»', signal => loadWeldingJournalRows('waitingControl', undefined, signal))
    }

    async function openWeldingJournalWaitingRepairReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('«Ожидает ремонт»', signal => loadWeldingJournalRows('waitingRepair', undefined, signal))
    }

    async function openWeldingJournalSystemReport() {
      setIsWeldingJournalShowMenuOpen(false)
      await openLoadedReport('системной версии сварочного журнала', signal => loadWeldingJournalRows('system', undefined, signal))
    }

    return {
      openLnkConclusionsReport,
      openLnkCurrentReport,
      openLnkToRequestReport,
      openLnkWaitingNkReport,
      openLnkWaitingRepairReport,
      openPstoCurrentReport,
      openPstoResultsReport,
      openPstoWaitingRequestReport,
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
