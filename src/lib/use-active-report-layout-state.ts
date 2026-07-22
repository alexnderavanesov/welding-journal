import type { Dispatch, SetStateAction } from 'react'
import type { WeldFilters } from '@/server/welds'
import type { ActiveReport } from '@/lib/home-state'
import { getWeldTableWidth } from '@/lib/weld-column-widths'
import { VISIBLE_FIELDS } from '@/lib/weld-fields'
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
}: UseActiveReportLayoutStateParams) {
  const activeColumnFilters = getActiveColumnFilters(activeReport, columnFilters, heatTreatmentFilters, lnkFilters)
  const activeFiltersSetter = getActiveReportFilterSetter(activeReport, setColumnFilters, setHeatTreatmentFilters, setLnkFilters)
  const registerMinWidth = getReportRegisterMinWidth(activeReport, getWeldTableWidth(VISIBLE_FIELDS))
  const stickyLeft = navCollapsed ? 80 : 288
  const activeTitle = getActiveReportTitle(activeReport)

  return {
    activeColumnFilters,
    activeFiltersSetter,
    activeTitle,
    registerMinWidth,
    stickyLeft,
  }
}
