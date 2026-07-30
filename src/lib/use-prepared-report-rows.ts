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
  enableHeatTreatmentRows?: boolean
  enableLnkRows?: boolean
  enablePstoRequestRows?: boolean
  enableLnkRequestRows?: boolean
  rows: WeldRow[]
  preservedLnkOrderIds: number[] | null
  pstoRequestSearch: string
  lnkRequestSearch: string
}

export function usePreparedReportRows({
  activeReport,
  enableHeatTreatmentRows = true,
  enableLnkRows = true,
  enablePstoRequestRows = true,
  enableLnkRequestRows = true,
  rows,
  preservedLnkOrderIds,
  pstoRequestSearch,
  lnkRequestSearch,
}: PreparedReportRowsOptions) {
  const shouldBuildDerivedReportRows = enableHeatTreatmentRows || enableLnkRows
  const weldedRows = useMemo(
    () => (shouldBuildDerivedReportRows ? rows.filter(hasWeldDate) : []),
    [rows, shouldBuildDerivedReportRows],
  )
  const heatTreatmentRows = useMemo(
    () => (enableHeatTreatmentRows ? buildHeatTreatmentReportRows(weldedRows) : []),
    [enableHeatTreatmentRows, weldedRows],
  )
  const availablePstoRequestRows = useMemo(
    () => (enablePstoRequestRows ? heatTreatmentRows.filter(canCreatePstoRequest) : []),
    [enablePstoRequestRows, heatTreatmentRows],
  )
  const filteredPstoRequestRows = useMemo(
    () => (enablePstoRequestRows ? filterPstoRequestRows(heatTreatmentRows, pstoRequestSearch) : []),
    [enablePstoRequestRows, heatTreatmentRows, pstoRequestSearch],
  )
  const filteredAvailablePstoRequestRows = useMemo(
    () => (enablePstoRequestRows ? filteredPstoRequestRows.filter(canCreatePstoRequest) : []),
    [enablePstoRequestRows, filteredPstoRequestRows],
  )
  const lnkRows = useMemo(
    () => (enableLnkRows ? buildLnkReportRows(weldedRows, preservedLnkOrderIds) : []),
    [enableLnkRows, preservedLnkOrderIds, weldedRows],
  )
  const availableLnkRequestRows = useMemo(
    () => (enableLnkRequestRows ? lnkRows.filter(canCreateLnkRequest) : []),
    [enableLnkRequestRows, lnkRows],
  )
  const filteredLnkRequestRows = useMemo(
    () => (enableLnkRequestRows ? filterLnkRequestRows(lnkRows, lnkRequestSearch) : []),
    [enableLnkRequestRows, lnkRequestSearch, lnkRows],
  )
  const filteredAvailableLnkRequestRows = useMemo(
    () => (enableLnkRequestRows ? filteredLnkRequestRows.filter(canCreateLnkRequest) : []),
    [enableLnkRequestRows, filteredLnkRequestRows],
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
