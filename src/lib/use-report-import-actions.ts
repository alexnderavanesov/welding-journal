import type { Dispatch, SetStateAction } from 'react'
import { getEditableReportImportLabel } from '@/lib/report-ui-state'
import { withOfficialJointStatus } from '@/lib/report-control-state'
import type { ActiveReport } from '@/lib/home-state'
import type { WeldInput } from '@/lib/weld-fields'

type EditableReportImportMutation = {
  mutateAsync: (records: WeldInput[]) => Promise<{ updated: number; skipped: number }>
}

type WeldJournalImportMutation = {
  mutateAsync: (records: WeldInput[]) => Promise<{ inserted: number }>
}

type UseReportImportActionsOptions = {
  activeReport: ActiveReport
  heatTreatmentImportMutation: EditableReportImportMutation
  lnkImportMutation: EditableReportImportMutation
  importMutation: WeldJournalImportMutation
  setMessage: Dispatch<SetStateAction<string | null>>
}

export function useReportImportActions({
  activeReport,
  heatTreatmentImportMutation,
  lnkImportMutation,
  importMutation,
  setMessage,
}: UseReportImportActionsOptions) {
  async function handleImportRecords(records: WeldInput[], skippedRows = 0) {
    setMessage(null)
    if (activeReport === 'heatTreatment' || activeReport === 'lnk') {
      const importResult =
        activeReport === 'heatTreatment'
          ? await heatTreatmentImportMutation.mutateAsync(records)
          : await lnkImportMutation.mutateAsync(records)
      setMessage(
        `Обновлено ${getEditableReportImportLabel(activeReport)}: ${importResult.updated}; пропущено: ${importResult.skipped + skippedRows}`,
      )
      return
    }

    const importResult = await importMutation.mutateAsync(records.map(withOfficialJointStatus))
    setMessage(`Добавлено ${importResult.inserted}, пропущено служебных строк: ${skippedRows}`)
  }

  return {
    handleImportRecords,
  }
}
