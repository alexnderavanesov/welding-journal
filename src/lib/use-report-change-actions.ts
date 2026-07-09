import type { Dispatch, SetStateAction } from 'react'
import type { ActiveReport } from '@/lib/home-state'
import type { WeldInput } from '@/lib/weld-fields'

type EditingState = {
  record: Partial<WeldInput> & { id?: number }
  focusField?: keyof WeldInput
} | null

type UseReportChangeActionsOptions = {
  setActiveReport: Dispatch<SetStateAction<ActiveReport>>
  setEditing: Dispatch<SetStateAction<EditingState>>
}

export function useReportChangeActions({
  setActiveReport,
  setEditing,
}: UseReportChangeActionsOptions) {
  function changeActiveReport(report: ActiveReport) {
    setActiveReport(report)
    if (
      report === 'heatTreatment' ||
      report === 'lnk' ||
      report === 'welderStamps' ||
      report === 'percentageLines' ||
      report === 'documents' ||
      report === 'settings'
    ) {
      setEditing(null)
    }
  }

  return {
    changeActiveReport,
  }
}
