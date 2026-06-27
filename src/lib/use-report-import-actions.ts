import type { Dispatch, SetStateAction } from 'react'
import { getReportImportFieldKeys, getEditableReportImportLabel } from '@/lib/report-ui-state'
import { withOfficialJointStatus } from '@/lib/report-control-state'
import {
  parseCsv,
  parseEditableCsv,
  parseEditableWorkbook,
  parseWorkbook,
} from '@/lib/weld-import-export'
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
  async function handleImport(file: File) {
    setMessage(null)
    if (activeReport === 'heatTreatment' || activeReport === 'lnk') {
      const options = getReportImportFieldKeys(activeReport)
      if (!options) return
      const result = file.name.toLowerCase().endsWith('.csv')
        ? parseEditableCsv(await file.text(), options)
        : parseEditableWorkbook(await file.arrayBuffer(), options)
      const importResult =
        activeReport === 'heatTreatment'
          ? await heatTreatmentImportMutation.mutateAsync(result.records)
          : await lnkImportMutation.mutateAsync(result.records)
      setMessage(
        `Обновлено ${getEditableReportImportLabel(activeReport)}: ${importResult.updated}; пропущено: ${importResult.skipped + result.skippedRows}`,
      )
      return
    }

    const result = file.name.toLowerCase().endsWith('.csv') ? parseCsv(await file.text()) : parseWorkbook(await file.arrayBuffer())
    const importResult = await importMutation.mutateAsync(result.records.map(withOfficialJointStatus))
    setMessage(`Добавлено ${importResult.inserted}, пропущено служебных строк: ${result.skippedRows}`)
  }

  return {
    handleImport,
  }
}
