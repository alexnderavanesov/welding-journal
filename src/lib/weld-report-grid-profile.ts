import type { ActiveReport } from './home-state'
import type { WeldFieldKey } from './weld-fields'

export const WELD_GRID_REQUIRED_FIELDS: ReadonlySet<WeldFieldKey> = new Set(['line', 'joint', 'wdi', 'weldDate', 'finalStatus'])

export const WELD_GRID_PROFILES = {
  weldingJournal: { title: 'Сварочный журнал', settingsLabel: 'Настройка вида журнала', storageKey: 'welding-journal-ag-grid:v1' },
  heatTreatment: { title: 'ПСТО и ТВМТ', settingsLabel: 'Настройка вида ПСТО и ТВМТ', storageKey: 'psto-ag-grid:v1' },
  lnk: { title: 'ЛНК', settingsLabel: 'Настройка вида ЛНК', storageKey: 'lnk-ag-grid:v1' },
} as const

export type AgGridWeldReport = keyof typeof WELD_GRID_PROFILES
export const isAgGridWeldReport = (report: ActiveReport): report is AgGridWeldReport => report in WELD_GRID_PROFILES
