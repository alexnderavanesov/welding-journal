import { useMemo } from 'react'
import type { ActiveReport } from '@/lib/home-state'
import { canCreatePstoRequest } from '@/lib/psto-status'
import { canCreateLnkRequest } from '@/lib/report-control-state'
import { filterLnkRequestRows, filterPstoRequestRows } from '@/lib/report-modal-rows'
import { buildHeatTreatmentReportRows, buildLnkReportRows } from '@/lib/report-row-utils'
import { getVisibleReportRows } from '@/lib/report-ui-state'
import { hasWeldDate } from '@/lib/report-value-utils'
import type { WeldRow } from '@/lib/dispatcher-types'

interface PreparedReportRowsOptions {
  activeReport: ActiveReport
  rows: WeldRow[]
  preservedLnkOrderIds: number[] | null
  pstoRequestSearch: string
  lnkRequestSearch: string
}

export function usePreparedReportRows({
  activeReport,
  rows,
  preservedLnkOrderIds,
  pstoRequestSearch,
  lnkRequestSearch,
}: PreparedReportRowsOptions) {
  const weldedRows = useMemo(() => rows.filter(hasWeldDate), [rows])
  const heatTreatmentRows = useMemo(
    () => buildHeatTreatmentReportRows(weldedRows),
    [weldedRows],
  )
  const availablePstoRequestRows = useMemo(() => heatTreatmentRows.filter(canCreatePstoRequest), [heatTreatmentRows])
  const filteredPstoRequestRows = useMemo(
    () => filterPstoRequestRows(heatTreatmentRows, pstoRequestSearch),
    [heatTreatmentRows, pstoRequestSearch],
  )
  const filteredAvailablePstoRequestRows = useMemo(
    () => filteredPstoRequestRows.filter(canCreatePstoRequest),
    [filteredPstoRequestRows],
  )
  const lnkRows = useMemo(() => buildLnkReportRows(weldedRows, preservedLnkOrderIds), [preservedLnkOrderIds, weldedRows])
  const availableLnkRequestRows = useMemo(() => lnkRows.filter(canCreateLnkRequest), [lnkRows])
  const filteredLnkRequestRows = useMemo(
    () => filterLnkRequestRows(lnkRows, lnkRequestSearch),
    [lnkRequestSearch, lnkRows],
  )
  const filteredAvailableLnkRequestRows = useMemo(
    () => filteredLnkRequestRows.filter(canCreateLnkRequest),
    [filteredLnkRequestRows],
  )
  const visibleRows = getVisibleReportRows(activeReport, rows, heatTreatmentRows, lnkRows)

  return {
    weldedRows,
    heatTreatmentRows,
    availablePstoRequestRows,
    filteredPstoRequestRows,
    filteredAvailablePstoRequestRows,
    lnkRows,
    availableLnkRequestRows,
    filteredLnkRequestRows,
    filteredAvailableLnkRequestRows,
    visibleRows,
  }
}
