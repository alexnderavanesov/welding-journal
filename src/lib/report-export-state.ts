import { getReportExportFields, getReportReadOnlyFieldKeys, type ReportKind } from '@/lib/report-export'
import { getReportHiddenFieldKeys, shouldMergePstoSections } from '@/lib/report-field-state'
import type { ActiveReport } from '@/lib/home-state'
import {
  getLnkVisibleFieldSections,
  type LnkVisibleFieldSectionOptions,
} from '@/lib/lnk-visible-field-layout'

export function getReportExportOptions(
  activeReport: ActiveReport,
  sheetName: string,
  controlProcessSettings: Partial<LnkVisibleFieldSectionOptions> = {},
) {
  const reportKind = isReportKind(activeReport) ? activeReport : 'weldingJournal'
  return {
    fields: getReportExportFields({
      storageKey: activeReport,
      hiddenFieldKeys: getReportHiddenFieldKeys(activeReport),
      mergePstoSections: shouldMergePstoSections(activeReport),
      sectionLayout: activeReport === 'lnk' ? getLnkVisibleFieldSections(controlProcessSettings) : undefined,
    }),
    readOnlyFieldKeys: getReportReadOnlyFieldKeys(reportKind),
    sheetName,
  }
}

function isReportKind(report: ActiveReport): report is ReportKind {
  return report === 'weldingJournal' || report === 'heatTreatment' || report === 'lnk' || report === 'welderStamps'
}
