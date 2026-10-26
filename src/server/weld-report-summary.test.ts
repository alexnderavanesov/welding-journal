import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'

const mocks = vi.hoisted(() => ({
  query: vi.fn(), fresh: vi.fn(), read: vi.fn(), security: vi.fn(), compute: vi.fn(), isFresh: vi.fn(), settings: vi.fn(),
}))
vi.mock('@/db', async () => {
  const { drizzle } = await import('drizzle-orm/node-postgres')
  return { requireDb: () => drizzle({ client: { query: mocks.query } as unknown as Pool }) }
})
vi.mock('@/server/security-functions', () => ({ assertSecurityScope: mocks.security }))
vi.mock('@/server/dispatcher-task-index', () => ({
  ensureDispatcherTaskIndexFresh: mocks.fresh, readDispatcherTaskIndexState: mocks.read,
  isDispatcherTaskIndexFresh: mocks.isFresh,
}))
vi.mock('@/server/derived-calculation-cache', () => ({ getOrComputeDerivedCalculation: mocks.compute }))
vi.mock('@/server/weld-server-shared', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/weld-server-shared')>(),
  loadServerOtherSettings: mocks.settings,
}))

import { WELD_TABLE_SELECT } from './weld-server-shared'
import { getWeldReportSummary, listColumnFilterOptions, listReportPage, normalizeWeldColumnFilterOptionsRequest, normalizeWeldPageRequest, readReportOutputSnapshot, visitReportOutput } from './weld-read'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'

describe('independent report rows and summaries', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.read.mockResolvedValue({ repeatedTasks: '{}' })
    mocks.fresh.mockResolvedValue({ repeatedTasks: '{}' })
    mocks.query.mockResolvedValue({ rows: [] })
    mocks.compute.mockImplementation((_key, compute) => compute())
    mocks.isFresh.mockReturnValue(true)
    mocks.settings.mockResolvedValue(DEFAULT_OTHER_SETTINGS)
  })

  it.each(['weldingJournal', 'lnk', 'heatTreatment'] as const)('%s first portion has no count or aggregate dependency', async report => {
    const page = await listReportPage(report, normalizeWeldPageRequest({ includeTotals: false, search: 'S999' }))
    expect(page).toMatchObject({ rows: [], page: 1, pageSize: 100, hasMore: false })
    expect(page.total).toBeUndefined()
    expect(page.acceptedWdiTotal).toBeUndefined()
    expect(page.availableRequestCount).toBeUndefined()
    expect(mocks.fresh).not.toHaveBeenCalled()
    expect(mocks.query).toHaveBeenCalledOnce()
    expect(mocks.query.mock.calls[0][0].text).not.toMatch(/count\(|sum\(/i)
    expect(mocks.query.mock.calls[0][1]).toContain(101)
    expect(mocks.compute).not.toHaveBeenCalled()
  })

  it('uses a lookahead row to keep pagination correct without totals', async () => {
    const keys = Object.keys(WELD_TABLE_SELECT)
    const sourceRows = Array.from({ length: 101 }, (_, i) => keys.map(key => {
      if (key === 'id') return i + 1
      if (key === 'joint') return `S${i + 1}`
      return null
    }))
    mocks.query.mockResolvedValueOnce({ rows: sourceRows })
    const page = await listReportPage('weldingJournal', normalizeWeldPageRequest({ includeTotals: false }))
    expect(page.rows).toHaveLength(100)
    expect(page.rows[0].id).toBe(1)
    expect(page.rows[99].id).toBe(100)
    expect(page.hasMore).toBe(true)
    expect(page.total).toBeUndefined()
    for (const [query] of mocks.query.mock.calls) expect(query.text).not.toMatch(/count\(|sum\(/i)
  })

  it.each([
    { finalStatus: 'годен' }, { columnFilters: { finalStatus: 'годен' } },
  ])('keeps the freshness barrier for status-filtered rows: %j', async filter => {
    await listReportPage('weldingJournal', normalizeWeldPageRequest({ ...filter, includeTotals: false }))
    expect(mocks.fresh).toHaveBeenCalledOnce()
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('journal summary waits for current statuses, then executes aggregates without hydrating cards', async () => {
    let release!: () => void
    mocks.fresh.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ repeatedTasks: '{}' }) }))
    mocks.query.mockImplementation(async ({ text, rowMode }) => ({ rows: text.includes('count(*)')
      ? [[200_000]] : rowMode === 'array' ? [] : [{ total: '123.5' }] }))
    const pending = getWeldReportSummary({ data: { report: 'weldingJournal', columnFilters: { line: '=LINE-1' } } })
    await vi.waitFor(() => expect(mocks.fresh).toHaveBeenCalledOnce())
    expect(mocks.query).not.toHaveBeenCalled()
    release()
    expect(await pending).toEqual({ total: 200_000, acceptedWdiTotal: 123.5 })
    expect(mocks.security).toHaveBeenCalledWith('entry')
    expect(mocks.query).toHaveBeenCalledTimes(2)
    for (const [query] of mocks.query.mock.calls) expect(query.text).not.toContain('"rowVersion"')
  })

  it.each(['weldingJournal', 'lnk', 'heatTreatment'] as const)('%s refuses stale status selection for both rows and complete output', async report => {
    mocks.isFresh.mockReturnValue(false)
    for (const pageSize of [100, 'all'] as const) {
      for (const filter of [{ finalStatus: 'годен' }, { columnFilters: { finalStatus: 'годен' } }]) {
        await expect(listReportPage(report, normalizeWeldPageRequest({ ...filter, pageSize, includeTotals: false })))
          .rejects.toThrow('актуальность итоговых статусов')
      }
    }
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.compute).not.toHaveBeenCalled()
  })

  it.each([
    { fieldKey: 'finalStatus' },
    { fieldKey: 'line', columnFilters: { finalStatus: 'годен' } },
    { fieldKey: 'line', finalStatus: 'годен' },
  ] as const)('refuses stale status-dependent filter options: %j', async request => {
    mocks.isFresh.mockReturnValue(false)
    await expect(listColumnFilterOptions(normalizeWeldColumnFilterOptionsRequest({ report: 'weldingJournal', ...request })))
      .rejects.toThrow('актуальность итоговых статусов')
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.compute).not.toHaveBeenCalled()
  })

  it.each(['lnk', 'heatTreatment'] as const)('%s summary counts the whole filtered selection with bounded queries', async report => {
    mocks.query.mockImplementation(async ({ text }) => ({ rows: [[text.includes('"vik_request"') ? 450 : 200_000]] }))
    const result = await getWeldReportSummary({ data: { report, columnFilters: { projectTitle: '=Проект', line: '=Линия' } } })
    expect(result).toEqual(report === 'lnk' ? { total: 200_000, availableRequestCount: 450 } : { total: 200_000 })
    expect(mocks.query).toHaveBeenCalledTimes(report === 'lnk' ? 2 : 1)
    for (const [query, params] of mocks.query.mock.calls) {
      expect(query.text).toContain('count(*)')
      expect(query.text).not.toContain(' limit ')
      expect(params).toEqual(expect.arrayContaining(['Проект', 'Линия']))
    }
  })

  it('still refuses oversized complete output even when totals are not requested', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [[10001]] })
    await expect(listReportPage('weldingJournal', normalizeWeldPageRequest({ pageSize: 'all', includeTotals: false })))
      .rejects.toThrow('более 10 000')
    expect(mocks.query).toHaveBeenCalledOnce()
  })

  it('rejects unauthorized summary reads before touching data', async () => {
    mocks.security.mockRejectedValueOnce(new Error('Нет доступа'))
    await expect(getWeldReportSummary({ data: { report: 'lnk' } })).rejects.toThrow('Нет доступа')
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('rejects unauthorized preview and full-file reads before reading data or producing rows', async () => {
    mocks.security.mockRejectedValue(new Error('Нет доступа'))
    const consume = vi.fn()
    await expect(readReportOutputSnapshot({ report: 'lnk' })).rejects.toThrow('Нет доступа')
    await expect(visitReportOutput({ report: 'lnk' }, consume)).rejects.toThrow('Нет доступа')
    expect(mocks.query).not.toHaveBeenCalled()
    expect(consume).not.toHaveBeenCalled()
  })

  it('reads WDI settings inside the revision-guarded calculation, not before it', async () => {
    mocks.compute.mockImplementation(async (_key, compute) => {
      // Another user saved formula mode after the request started but before
      // the cache captured its source revision. Old manual settings must not
      // become a persistent result under that new revision.
      mocks.settings.mockResolvedValue({ ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula' })
      return compute()
    })
    await getWeldReportSummary({ data: { report: 'weldingJournal' } })
    expect(mocks.query.mock.calls.some(([query]) => query.text.includes('current_wdi_dimensions'))).toBe(true)
  })

  it('does not present a still-stale dispatcher result as current totals', async () => {
    mocks.isFresh.mockReturnValue(false)
    await expect(getWeldReportSummary({ data: { report: 'weldingJournal' } }))
      .rejects.toThrow('подсчёт')
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.compute).not.toHaveBeenCalled()
  })

  it.each(['lnk', 'heatTreatment'] as const)('%s derived totals use SQL without a full-card/ID cache', async report => {
    mocks.query.mockResolvedValue({ rows: [[12]] })
    await getWeldReportSummary({ data: { report, columnFilters: { preRkResult: '=ремонт' } } })
    expect(mocks.query).toHaveBeenCalledTimes(report === 'lnk' ? 2 : 1)
    for (const [query, params] of mocks.query.mock.calls) {
      expect(query.text).toContain('count(*)')
      expect(query.text).toContain('"pre_heat_treatment_controls"')
      expect(params).toContain('ремонт')
    }
    expect(mocks.compute).toHaveBeenCalledOnce()
  })
  it.each([{ current: [] }, { current: [{ id: 1, rowVersion: 'new' }] }])('rejects a cached page whose card was deleted or concurrently edited', async ({ current }) => {
    mocks.compute.mockResolvedValue([{ id: 1, rowVersion: 'old' }])
    mocks.query.mockResolvedValue({ rows: current.map(row => Object.keys(WELD_TABLE_SELECT).map(key => row[key as keyof typeof row] ?? null)) })
    await expect(listReportPage('lnk', normalizeWeldPageRequest({ includeTotals: false,
      columnFilters: { rkResult: '=ремонт' },
    }))).rejects.toThrow('изменились во время отбора')
    expect(mocks.query).toHaveBeenCalledOnce()
  })

  it('bounded selection cache separates pages and sorts and never serves full output', async () => {
    mocks.compute.mockResolvedValue([])
    for (const page of [1, 2]) for (const direction of ['asc', 'desc'] as const) {
      await listReportPage('lnk', normalizeWeldPageRequest({ page, includeTotals: false,
        columnFilters: { rkResult: '=ремонт' }, sort: { fieldKey: 'joint', direction },
      }))
    }
    expect(new Set(mocks.compute.mock.calls.map(([key]) => key)).size).toBe(4)
    mocks.compute.mockClear()
    await listReportPage('lnk', normalizeWeldPageRequest({ pageSize: 'all', includeTotals: false, columnFilters: { rkResult: '=ремонт' } }))
    expect(mocks.compute).not.toHaveBeenCalled()
  })

  it.each(['wdi', 'rkExposureScheme'] as const)('separates bounded %s pages by captured settings, including a change back', async field => {
    mocks.compute.mockResolvedValue([])
    const first = { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula' as const }
    const second = { ...first, wdiCalculationMode: 'table' as const,
      wdiTable: { fileName: 'WDI', uploadedAt: '', diameters: [100], thicknesses: [5], values: [[7.25]] },
      rkExposureTable: { fileName: 'large', uploadedAt: '',
      entries: Array.from({ length: 300 }, (_, i) => ({ diameter: i + 1,
        options: [{ label: 'Схема', values: ['0', '120'], isDefault: true, note: '' }],
      })),
    } }
    for (const settings of [first, second, first]) {
      mocks.settings.mockResolvedValue(settings)
      await listReportPage('weldingJournal', normalizeWeldPageRequest({ includeTotals: false,
        columnFilters: { [field]: '=значение' },
      }))
    }
    const keys = mocks.compute.mock.calls.map(([key]) => key as string)
    expect(keys).toHaveLength(3)
    expect(keys[0]).not.toBe(keys[1])
    expect(keys[2]).toBe(keys[0])
    expect(keys.every(key => key.length < 1000)).toBe(true)
  })

})
