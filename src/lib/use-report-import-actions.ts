import type { Dispatch, SetStateAction } from 'react'
import { getReportImportFieldKeys, getEditableReportImportLabel } from '@/lib/report-ui-state'
import { withOfficialJointStatus } from '@/lib/report-control-state'
import {
  parseCsv,
  parseEditableCsv,
  parseEditableWorkbook,
  parseWorkbook,
} from '@/lib/weld-import-export'
import { stripIgnoredImportFields } from '@/lib/report-import-template'
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

  async function handleImport(file: File) {
    if (activeReport === 'heatTreatment' || activeReport === 'lnk') {
      const options = getReportImportFieldKeys(activeReport)
      if (!options) return
      const result = file.name.toLowerCase().endsWith('.csv')
        ? parseEditableCsv(await file.text(), options)
        : parseEditableWorkbook(await file.arrayBuffer(), options)
      await handleImportRecords(result.records, result.skippedRows)
      return
    }

    const result = file.name.toLowerCase().endsWith('.csv') ? parseCsv(await file.text()) : parseWorkbook(await file.arrayBuffer())
    await handleImportRecords(
      result.records.map((record) => stripIgnoredImportFields(record, activeReport)),
      result.skippedRows,
    )
  }

  return {
    handleImport,
    handleImportRecords,
  }
}
