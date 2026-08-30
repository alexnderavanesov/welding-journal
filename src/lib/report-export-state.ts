import { getReportExportFields, getReportReadOnlyFieldKeys, type ReportKind } from '@/lib/report-export'
import { getReportHiddenFieldKeys, shouldMergePstoSections } from '@/lib/report-field-state'
import type { ActiveReport } from '@/lib/home-state'
import { LNK_VISIBLE_FIELD_SECTIONS } from '@/lib/lnk-visible-field-layout'

export function getReportExportOptions(activeReport: ActiveReport, sheetName: string) {
  const reportKind = isReportKind(activeReport) ? activeReport : 'weldingJournal'
  return {
    fields: getReportExportFields({
      storageKey: activeReport,
      hiddenFieldKeys: getReportHiddenFieldKeys(activeReport),
      mergePstoSections: shouldMergePstoSections(activeReport),
      sectionLayout: activeReport === 'lnk' ? LNK_VISIBLE_FIELD_SECTIONS : undefined,
    }),
    readOnlyFieldKeys: getReportReadOnlyFieldKeys(reportKind),
    sheetName,
  }
}

function isReportKind(report: ActiveReport): report is ReportKind {
  return report === 'weldingJournal' || report === 'heatTreatment' || report === 'lnk' || report === 'welderStamps'
}
