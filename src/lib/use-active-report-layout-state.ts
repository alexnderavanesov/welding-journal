import { useMemo, type Dispatch, type SetStateAction } from 'react'
import type { WeldFilters } from '@/server/welds'
import type { ActiveReport } from '@/lib/home-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getWeldTableWidth } from '@/lib/weld-column-widths'
import { VISIBLE_FIELDS } from '@/lib/weld-fields'
import { sumAcceptedWdi } from '@/lib/report-row-utils'
import {
  getActiveColumnFilters,
  getActiveReportFilterSetter,
  getActiveReportTitle,
  getReportRegisterMinWidth,
} from '@/lib/report-ui-state'

type UseActiveReportLayoutStateParams = {
  activeReport: ActiveReport
  columnFilters: WeldFilters
  heatTreatmentFilters: WeldFilters
  lnkFilters: WeldFilters
  setColumnFilters: Dispatch<SetStateAction<WeldFilters>>
  setHeatTreatmentFilters: Dispatch<SetStateAction<WeldFilters>>
  setLnkFilters: Dispatch<SetStateAction<WeldFilters>>
  navCollapsed: boolean
  rows: WeldRow[]
}

export function useActiveReportLayoutState({
  activeReport,
  columnFilters,
  heatTreatmentFilters,
  lnkFilters,
  setColumnFilters,
  setHeatTreatmentFilters,
  setLnkFilters,
  navCollapsed,
  rows,
}: UseActiveReportLayoutStateParams) {
  const activeColumnFilters = getActiveColumnFilters(activeReport, columnFilters, heatTreatmentFilters, lnkFilters)
  const activeFiltersSetter = getActiveReportFilterSetter(activeReport, setColumnFilters, setHeatTreatmentFilters, setLnkFilters)
  const acceptedWdiTotal = useMemo(() => sumAcceptedWdi(rows), [rows])
  const registerMinWidth = getReportRegisterMinWidth(activeReport, getWeldTableWidth(VISIBLE_FIELDS))
  const stickyLeft = navCollapsed ? 80 : 288
  const activeTitle = getActiveReportTitle(activeReport)

  return {
    acceptedWdiTotal,
    activeColumnFilters,
    activeFiltersSetter,
    activeTitle,
    registerMinWidth,
    stickyLeft,
  }
}
