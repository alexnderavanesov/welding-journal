import { getReportExportFields, getReportReadOnlyFieldKeys } from '@/lib/report-export'
import { getReportHiddenFieldKeys, shouldMergePstoSections } from '@/lib/report-field-state'
import type { ActiveReport } from '@/lib/home-state'

export function getReportExportOptions(activeReport: ActiveReport, sheetName: string) {
  return {
    fields: getReportExportFields({
      storageKey: activeReport,
      hiddenFieldKeys: getReportHiddenFieldKeys(activeReport),
      mergePstoSections: shouldMergePstoSections(activeReport),
    }),
    readOnlyFieldKeys: getReportReadOnlyFieldKeys(activeReport),
    sheetName,
  }
}
