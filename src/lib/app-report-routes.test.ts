import { describe, expect, it } from 'vitest'
import {
  APP_REPORT_ROUTES,
  getActiveReportFromPath,
  getAppReportPath,
} from '@/lib/app-report-routes'

describe('application report routes', () => {
  it('has a unique path for every report', () => {
    expect(new Set(Object.values(APP_REPORT_ROUTES)).size).toBe(Object.keys(APP_REPORT_ROUTES).length)
  })

  it.each(Object.entries(APP_REPORT_ROUTES))('maps %s to %s and back', (report, path) => {
    expect(getAppReportPath(report as keyof typeof APP_REPORT_ROUTES)).toBe(path)
    expect(getActiveReportFromPath(path)).toBe(report)
    expect(getActiveReportFromPath(`${path}/`)).toBe(report)
  })

  it('falls back to the welding journal for an unknown path', () => {
    expect(getActiveReportFromPath('/unknown')).toBe('weldingJournal')
  })
})
