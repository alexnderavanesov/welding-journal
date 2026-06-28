import {
  HEAT_TREATMENT_EDITABLE_FIELD_KEYS,
  HEAT_TREATMENT_HIDDEN_FIELD_KEYS,
  HEAT_TREATMENT_IMPORT_MATCH_FIELD_KEYS,
  LNK_EDITABLE_FIELD_KEYS,
  LNK_HIDDEN_FIELD_KEYS,
  LNK_IMPORT_MATCH_FIELD_KEYS,
  WELDING_JOURNAL_BLOCKED_FIELD_KEYS,
  WELDING_JOURNAL_HIDDEN_FIELD_KEYS,
} from '@/lib/report-config'
import type { ActiveReport } from '@/lib/home-state'

export function getReportEditableFieldKeys(activeReport: ActiveReport) {
  if (activeReport === 'heatTreatment') return HEAT_TREATMENT_EDITABLE_FIELD_KEYS
  if (activeReport === 'lnk') return LNK_EDITABLE_FIELD_KEYS
  return undefined
}

export function getReportImportFieldKeys(activeReport: ActiveReport) {
  if (activeReport === 'heatTreatment') {
    return {
      editableFieldKeys: HEAT_TREATMENT_EDITABLE_FIELD_KEYS,
      matchFieldKeys: HEAT_TREATMENT_IMPORT_MATCH_FIELD_KEYS,
    }
  }
  if (activeReport === 'lnk') {
    return {
      editableFieldKeys: LNK_EDITABLE_FIELD_KEYS,
      matchFieldKeys: LNK_IMPORT_MATCH_FIELD_KEYS,
    }
  }
  return null
}

export function getReportHiddenFieldKeys(activeReport: ActiveReport) {
  if (activeReport === 'heatTreatment') return HEAT_TREATMENT_HIDDEN_FIELD_KEYS
  if (activeReport === 'lnk') return LNK_HIDDEN_FIELD_KEYS
  return WELDING_JOURNAL_HIDDEN_FIELD_KEYS
}

export function getReportBlockedFieldKeys(activeReport: ActiveReport) {
  return activeReport === 'weldingJournal' ? WELDING_JOURNAL_BLOCKED_FIELD_KEYS : undefined
}

export function shouldMergePstoSections(activeReport: ActiveReport) {
  return activeReport === 'heatTreatment'
}

export function isReadOnlyReport(activeReport: ActiveReport) {
  return activeReport === 'heatTreatment' || activeReport === 'lnk'
}

export function canOpenLinkedReport(activeReport: ActiveReport) {
  return activeReport === 'weldingJournal' || activeReport === 'lnk'
}

export function getOpenLinkedReportTitle(activeReport: ActiveReport) {
  return activeReport === 'lnk' ? 'Открыть стык в сварочном журнале' : 'Открыть стык в отчете ЛНК'
}
