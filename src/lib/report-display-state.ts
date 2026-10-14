import type { ActiveReport } from '@/lib/home-state'

const ACTIVE_REPORT_TITLES: Record<ActiveReport, string> = {
  weldingJournal: 'Сварочный журнал',
  heatTreatment: 'ПСТО и ТВМТ',
  lnk: 'ЛНК',
  welderStamps: 'Клейма',
  percentageLines: 'Программа линий',
  statistics: 'Статистика',
  documents: 'Документы',
  settings: 'Настройки',
  userGuide: 'Руководство пользователя',
}

const REPORT_EXPORT_FILENAMES: Record<ActiveReport, string> = {
  weldingJournal: 'welding-register.xlsx',
  heatTreatment: 'heat-treatment-register.xlsx',
  lnk: 'lnk-register.xlsx',
  welderStamps: 'welder-stamps-register.xlsx',
  percentageLines: 'percentage-lines.xlsx',
  statistics: 'statistics.xlsx',
  documents: 'documents.xlsx',
  settings: 'settings.xlsx',
  userGuide: 'Руководство пользователя. Учет сварки.pdf',
}

const EDITABLE_REPORT_IMPORT_LABELS: Partial<Record<ActiveReport, string>> = {
  heatTreatment: 'ПСТО',
  lnk: 'ЛНК',
}

export type ReportSummaryTextParams = {
  activeReport: ActiveReport
  isLoading: boolean
  summaryStatus?: 'pending' | 'ready' | 'error'
  weldingRowCount: number | undefined
  acceptedWdiTotalText: string
  heatTreatmentRowCount: number | undefined
  selectedHeatTreatmentRowCount: number
  lnkRowCount: number | undefined
  availableLnkRequestRowCount: number | undefined
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
  summaryStatus,
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
  if (summaryStatus === 'pending' || summaryStatus === 'error') {
    const text = summaryStatus === 'error' ? 'Не удалось подсчитать итоги' : 'Идёт подсчёт…'
    return activeReport === 'heatTreatment' ? `${text} · Выбрано: ${selectedHeatTreatmentRowCount}` : text
  }
  if (activeReport === 'heatTreatment') {
    return `Стыков на ПСТО: ${heatTreatmentRowCount ?? 'Недоступно'} · Выбрано: ${selectedHeatTreatmentRowCount}`
  }
  if (activeReport === 'lnk') {
    return `Стыков на ЛНК: ${lnkRowCount ?? 'Недоступно'} · Доступно для основной заявки: ${availableLnkRequestRowCount ?? 'Недоступно'}`
  }
  if (activeReport === 'welderStamps') {
    return `Клейм: ${activeWelderStampCount} · Архив: ${archivedWelderStampCount} · Найдено: ${filteredWelderStampCount}`
  }
  if (activeReport === 'statistics') {
    return 'Общая сводка по сварке и контролю'
  }
  if (activeReport === 'percentageLines') {
    return 'Расчет контроля по процентным линиям'
  }
  if (activeReport === 'documents') {
    return 'Формирование документов по данным системы'
  }
  if (activeReport === 'settings') {
    return 'Настройки системы и шаблонов документов'
  }
  if (activeReport === 'userGuide') {
    return 'Подробное руководство по разделам, кнопкам, правилам и кейсам'
  }
  return `Записей: ${weldingRowCount ?? 'Недоступно'} · WDI годных: ${acceptedWdiTotalText}`
}

export function getReportExportFilename(activeReport: ActiveReport) {
  return REPORT_EXPORT_FILENAMES[activeReport]
}

export function getEditableReportImportLabel(activeReport: ActiveReport) {
  return EDITABLE_REPORT_IMPORT_LABELS[activeReport] ?? getActiveReportTitle(activeReport)
}
