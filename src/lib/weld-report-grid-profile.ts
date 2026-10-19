import type { ActiveReport } from './home-state'

export const WELD_GRID_PROFILES = {
  weldingJournal: { title: 'Сварочный журнал', settingsLabel: 'Настройка вида журнала', storageKey: 'welding-journal-ag-grid:v1' },
  heatTreatment: { title: 'ПСТО и ТВМТ', settingsLabel: 'Настройка вида ПСТО и ТВМТ', storageKey: 'psto-ag-grid:v1' },
} as const

export type AgGridWeldReport = keyof typeof WELD_GRID_PROFILES
export const isAgGridWeldReport = (report: ActiveReport): report is AgGridWeldReport => report in WELD_GRID_PROFILES
