import type { ActiveReport } from '@/lib/home-state'

export const APP_REPORT_ROUTES = {
  weldingJournal: '/journal',
  heatTreatment: '/psto',
  lnk: '/lnk',
  welderStamps: '/welder-stamps',
  percentageLines: '/percentage-lines',
  statistics: '/statistics',
  documents: '/documents',
  settings: '/settings',
  userGuide: '/user-guide',
} as const satisfies Record<ActiveReport, string>

export type AppReportPath = (typeof APP_REPORT_ROUTES)[ActiveReport]

const REPORT_BY_PATH = new Map<string, ActiveReport>(
  Object.entries(APP_REPORT_ROUTES).map(([report, path]) => [path, report as ActiveReport]),
)

export function getAppReportPath(report: ActiveReport): AppReportPath {
  return APP_REPORT_ROUTES[report]
}

export function getActiveReportFromPath(pathname: string): ActiveReport {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return REPORT_BY_PATH.get(normalizedPath) ?? 'weldingJournal'
}
