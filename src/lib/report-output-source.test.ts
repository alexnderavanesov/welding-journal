import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeldSort } from '@/server/weld-contracts'
const serverMocks = vi.hoisted(() => ({ readReportOutputSnapshot: vi.fn() }))
vi.mock('@/server/weld-read-api', () => serverMocks)
import { loadReportOutputSnapshot } from './report-output-source'

describe('explicit report snapshots', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
  it('keeps every row beyond modal limits and reads a fresh snapshot on each reopening', async () => {
    const first = { report: { title: 'First' }, sourceRows: 501, truncated: false, generatedAt: '2026-10-25T18:00:00Z' }
    const second = { ...first, sourceRows: 502, generatedAt: '2026-10-25T18:01:00Z' }
    serverMocks.readReportOutputSnapshot.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    expect(await loadReportOutputSnapshot({ report: 'lnk' })).toMatchObject(first)
    expect(await loadReportOutputSnapshot({ report: 'lnk' })).toMatchObject(second)
    expect(first.sourceRows).toBe(501)
    expect(second.sourceRows).toBe(502)
    expect(serverMocks.readReportOutputSnapshot).toHaveBeenCalledTimes(2)
  })
  it('captures filters and sort before awaiting the server', async () => {
    let resolve!: (value: unknown) => void
    serverMocks.readReportOutputSnapshot.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const columnFilters = { line: '=A', search: 'S1' }
    const sort: WeldSort = { fieldKey: 'joint', direction: 'desc' }
    const loading = loadReportOutputSnapshot({ report: 'heatTreatment', columnFilters, sort })
    columnFilters.line = '=B'; columnFilters.search = 'S2'; sort.fieldKey = 'line'
    const snapshot = { report: { title: 'Snapshot' }, sourceRows: 1, truncated: false, generatedAt: '2026-10-25T18:00:00Z' }
    resolve(snapshot)
    expect(await loading).toMatchObject(snapshot)
    expect(serverMocks.readReportOutputSnapshot).toHaveBeenCalledExactlyOnceWith({ data: {
      report: 'heatTreatment', columnFilters: { line: '=A', search: 'S1' }, sort: { fieldKey: 'joint', direction: 'desc' },
    } })
  })
})

it('downloads fresh files on demand with the captured filters, order and columns, independent of preview rows', async () => {
  vi.useFakeTimers()
  serverMocks.readReportOutputSnapshot.mockResolvedValue({ report: { title: 'Limited preview', tables: [] }, sourceRows: 200000, truncated: true, generatedAt: '2026-10-26T12:00:00Z' })
  const fetch = vi.fn(async () => new Response('full workbook', { headers: { 'X-Report-Filename': 'welding-journal-current.xlsx' } }))
  vi.stubGlobal('fetch', fetch)
  const create = vi.fn(() => 'blob:full'), revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const fieldKeys = ['joint', 'line'], columnFilters = { line: '=A' }, sort: WeldSort = { fieldKey: 'joint', direction: 'desc' }
  const output = await loadReportOutputSnapshot({ report: 'weldingJournal', fieldKeys, columnFilters, sort })
  expect(fetch).not.toHaveBeenCalled()
  fieldKeys.reverse(); columnFilters.line = '=B'; sort.direction = 'asc'
  for (let repeat = 0; repeat < 2; repeat++) await output.onDownloadExcel()
  expect(fetch).toHaveBeenCalledTimes(2)
  for (const call of fetch.mock.calls) expect(JSON.parse((call as unknown as [string, RequestInit])[1].body as string)).toMatchObject({
    fieldKeys: ['joint', 'line'], columnFilters: { line: '=A' }, sort: { fieldKey: 'joint', direction: 'desc' },
  })
  expect(click).toHaveBeenCalledTimes(2)
  expect(document.querySelector('a[download]')).toBeNull()
  vi.runAllTimers(); expect(revoke).toHaveBeenCalledTimes(2)
})
