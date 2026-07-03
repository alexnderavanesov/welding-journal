import type { ActiveReport } from '@/lib/home-state'

const ACTIVE_REPORT_TITLES: Record<ActiveReport, string> = {
  weldingJournal: 'Сварочный журнал',
  heatTreatment: 'Термообработка',
  lnk: 'ЛНК',
  welderStamps: 'Клейма',
  statistics: 'Статистика',
}

const REPORT_EXPORT_FILENAMES: Record<ActiveReport, string> = {
  weldingJournal: 'welding-register.xlsx',
  heatTreatment: 'heat-treatment-register.xlsx',
  lnk: 'lnk-register.xlsx',
  welderStamps: 'welder-stamps-register.xlsx',
  statistics: 'statistics.xlsx',
}

const EDITABLE_REPORT_IMPORT_LABELS: Partial<Record<ActiveReport, string>> = {
  heatTreatment: 'ПСТО',
  lnk: 'ЛНК',
}

export type ReportSummaryTextParams = {
  activeReport: ActiveReport
  isLoading: boolean
  weldingRowCount: number
  acceptedWdiTotalText: string
  heatTreatmentRowCount: number
  selectedHeatTreatmentRowCount: number
  lnkRowCount: number
  availableLnkRequestRowCount: number
  activeWelderStampCount: number
  archivedWelderStampCount: number
  filteredWelderStampCount: number
}

export function getActiveReportTitle(activeReport: ActiveReport) {
  return ACTIVE_REPORT_TITLES[activeReport]
}

export function getReportSummaryText({
  activeReport,
  isLoading,
  weldingRowCount,
  acceptedWdiTotalText,
  heatTreatmentRowCount,
  selectedHeatTreatmentRowCount,
  lnkRowCount,
  availableLnkRequestRowCount,
  activeWelderStampCount,
  archivedWelderStampCount,
  filteredWelderStampCount,
}: ReportSummaryTextParams) {
  if (isLoading) return 'Загрузка...'
  if (activeReport === 'heatTreatment') {
    return `Стыков на ПСТО: ${heatTreatmentRowCount} · Выбрано: ${selectedHeatTreatmentRowCount}`
  }
  if (activeReport === 'lnk') {
    return `Стыков на ЛНК: ${lnkRowCount} · Доступно для новой заявки: ${availableLnkRequestRowCount}`
  }
  if (activeReport === 'welderStamps') {
    return `Клейм: ${activeWelderStampCount} · Архив: ${archivedWelderStampCount} · Найдено: ${filteredWelderStampCount}`
  }
  if (activeReport === 'statistics') {
    return 'Общая сводка по сварке и контролю'
  }
  return `Записей: ${weldingRowCount} · WDI годных: ${acceptedWdiTotalText}`
}

export function getReportExportFilename(activeReport: ActiveReport) {
  return REPORT_EXPORT_FILENAMES[activeReport]
}

export function getEditableReportImportLabel(activeReport: ActiveReport) {
  return EDITABLE_REPORT_IMPORT_LABELS[activeReport] ?? getActiveReportTitle(activeReport)
}
