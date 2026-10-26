import { expect, it } from 'vitest'
import { getReportOutputBuilder } from './report-output-definition'
import type { ReportOutputRequest } from '@/server/weld-contracts'

it('preserves the authoritative repair status even when its rejected namesake is in another batch', () => {
  const content = getReportOutputBuilder({ report: 'weldingJournal', fieldKeys: ['joint', 'finalStatus'] })([
    { joint: 'F1', officiality: 'действующий', weldDate: '', finalStatus: 'ожидает ремонт' },
  ])
  expect(content.report.tables![0].rows).toEqual([['F1', 'ожидает ремонт']])
})

it.each([
  { report: 'lnk', kind: 'constructor' }, { report: 'lnk', kind: 'system' },
  { report: 'weldingJournal', fieldKeys: ['joint', 'joint'] },
  { report: 'weldingJournal', fieldKeys: ['unknown'] },
  { report: 'weldingJournal', fieldKeys: [] },
])('rejects an invalid output definition: %j', input => {
  expect(() => getReportOutputBuilder(input as ReportOutputRequest)).toThrow()
})
