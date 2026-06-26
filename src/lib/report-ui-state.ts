import {
  HEAT_TREATMENT_EDITABLE_FIELD_KEYS,
  HEAT_TREATMENT_HIDDEN_FIELD_KEYS,
  HEAT_TREATMENT_IMPORT_MATCH_FIELD_KEYS,
  LNK_EDITABLE_FIELD_KEYS,
  LNK_HIDDEN_FIELD_KEYS,
  LNK_METHODS,
  LNK_IMPORT_MATCH_FIELD_KEYS,
  WELDING_JOURNAL_BLOCKED_FIELD_KEYS,
  WELDING_JOURNAL_HIDDEN_FIELD_KEYS,
} from '@/lib/report-config'
import type { ActiveReport } from '@/lib/home-state'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

const ACTIVE_REPORT_TITLES: Record<ActiveReport, string> = {
  weldingJournal: 'Сварочный журнал',
  heatTreatment: 'Термообработка',
  lnk: 'ЛНК',
  welderStamps: 'Клейма',
}

export function getActiveReportTitle(activeReport: ActiveReport) {
  return ACTIVE_REPORT_TITLES[activeReport]
}

export function getVisibleReportRows<T>(
  activeReport: ActiveReport,
  weldingRows: T[],
  heatTreatmentRows: T[],
  lnkRows: T[],
) {
  if (activeReport === 'heatTreatment') return heatTreatmentRows
  if (activeReport === 'lnk') return lnkRows
  return weldingRows
}

export function getReportRegisterMinWidth(activeReport: ActiveReport, defaultMinWidth: number) {
  return activeReport === 'welderStamps' ? 1120 : defaultMinWidth
}

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

export function getActiveColumnFilters(
  activeReport: ActiveReport,
  weldingFilters: Record<string, string>,
  heatTreatmentFilters: Record<string, string>,
  lnkFilters: Record<string, string>,
) {
  if (activeReport === 'heatTreatment') return heatTreatmentFilters
  if (activeReport === 'lnk') return lnkFilters
  return weldingFilters
}

export function makeExactColumnFilterValue(value: unknown) {
  return `=${String(value ?? '').trim().toLowerCase()}`
}

export function getJointTitle(value: WeldInput) {
  const line = String(value.line ?? '').trim()
  const joint = String(value.joint ?? '').trim()

  if (!line && !joint) return 'Линия и стык не заполнены.'
  return `${line || '-'} · ${joint || '-'}`
}

export function expandHighlightFieldKeys(fieldKeys: WeldFieldKey[]) {
  const expanded = new Set<WeldFieldKey>(fieldKeys)
  if (expanded.has('weldDate')) {
    expanded.add('hasVik')
  }
  if (
    expanded.has('pstoRequired') ||
    expanded.has('pstoRequest') ||
    expanded.has('pstoDate') ||
    expanded.has('pstoResult') ||
    expanded.has('heatTreatmentDiagram')
  ) {
    expanded.add('pstoCreatedAt')
  }
  if (
    LNK_METHODS.some(
      (method) =>
        expanded.has(method.enabledKey) ||
        expanded.has(method.requestKey) ||
        expanded.has(method.resultKey) ||
        expanded.has(method.conclusionDateKey) ||
        expanded.has(method.conclusionKey),
    )
  ) {
    expanded.add('lnkCreatedAt')
    expanded.add('finalStatus')
  }
  return [...expanded]
}

export function getCellKey(rowId: number, fieldKey: WeldFieldKey) {
  return `${rowId}:${fieldKey}`
}

export function buildHighlightSets(rows: Array<{ id?: number }> | undefined, cellFieldKeys: WeldFieldKey[] = []) {
  const rowIds = new Set(
    (rows ?? [])
      .map((row) => row.id)
      .filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
  )
  if (rowIds.size === 0) return null

  const cellKeys = new Set<string>()
  const expandedFieldKeys = expandHighlightFieldKeys(cellFieldKeys)
  for (const id of rowIds) {
    for (const fieldKey of expandedFieldKeys) {
      cellKeys.add(getCellKey(id, fieldKey))
    }
  }

  return { rowIds, cellKeys }
}

export function toggleNumberSetValue(current: ReadonlySet<number>, value: number) {
  const next = new Set(current)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  return next
}

export function setNumberSetValues(current: ReadonlySet<number>, values: Iterable<number>, selected: boolean) {
  const next = new Set(current)
  for (const value of values) {
    if (selected) {
      next.add(value)
    } else {
      next.delete(value)
    }
  }
  return next
}

export function toggleNumberSetValues(current: ReadonlySet<number>, values: Iterable<number>) {
  const valueSet = new Set(values)
  if (valueSet.size === 0) return current
  const allSelected = [...valueSet].every((value) => current.has(value))
  return allSelected
    ? new Set([...current].filter((value) => !valueSet.has(value)))
    : new Set([...current, ...valueSet])
}
