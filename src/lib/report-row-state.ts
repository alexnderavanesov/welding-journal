import type { ActiveReport } from '@/lib/home-state'
import type { WeldInput } from '@/lib/weld-fields'

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
  if (
    activeReport === 'statistics' ||
    activeReport === 'percentageLines' ||
    activeReport === 'documents' ||
    activeReport === 'settings' ||
    activeReport === 'userGuide'
  ) {
    return 1180
  }
  return activeReport === 'welderStamps' ? 1120 : defaultMinWidth
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

export function getActiveReportFilterSetter<T>(
  activeReport: ActiveReport,
  weldingFilterSetter: T,
  heatTreatmentFilterSetter: T,
  lnkFilterSetter: T,
) {
  if (activeReport === 'heatTreatment') return heatTreatmentFilterSetter
  if (activeReport === 'lnk') return lnkFilterSetter
  return weldingFilterSetter
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
