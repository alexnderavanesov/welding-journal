import { sortReportRows } from './report-filter-reference.test-helper'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { getPstoDisplayValue } from '@/lib/lnk-status'
import { createWeldGroupSummarizer } from '@/lib/weld-group-summary'
import { prepareReportRows } from '@/lib/use-report-rows'

const mocks = vi.hoisted(() => ({ query: vi.fn(), compute: vi.fn() }))
vi.mock('@/db', async () => {
  const { drizzle } = await import('drizzle-orm/node-postgres')
  return { requireDb: () => drizzle({ client: { query: mocks.query } as unknown as Pool }) }
})
vi.mock('@/server/dispatcher-task-index', () => ({
  readDispatcherTaskIndexState: async () => ({ repeatedTasks: '{}' }),
  ensureDispatcherTaskIndexFresh: vi.fn(),
  isDispatcherTaskIndexFresh: () => true,
}))
vi.mock('@/server/derived-calculation-cache', () => ({ getOrComputeDerivedCalculation: mocks.compute }))
vi.mock('@/server/weld-server-shared', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/weld-server-shared')>(),
  loadServerOtherSettings: async () => DEFAULT_OTHER_SETTINGS,
}))

import { WELD_TABLE_SELECT } from './weld-server-shared'
import {
  buildServerReportRows,
  listReportPage,
  normalizeWeldPageRequest,
} from './weld-read'

const sourceRows = [
  { id: 2, joint: 'F970202', weldDate: '2026-09-01', hasVik: 'да', pstoRequired: 'да' },
  { id: 1, joint: 'F970101', weldDate: '2026-09-01', hasVik: 'да', pstoRequired: 'да' },
] as WeldRow[]

function databaseRows(select: Record<string, unknown>, rows = sourceRows) {
  return rows.map(row => Object.keys(select).map(key => row[key as keyof WeldRow] ?? null))
}

describe('SQL-sorted report output survives server hydration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.query.mockResolvedValue({ rows: [] })
    mocks.compute.mockImplementation((_key, compute) => compute())
  })

  it('checks the previous PSTO sort reference by prepared primary waiting labels while preserving sparse repeat and raw facts', () => {
    const rows: WeldRow[] = [
      { id: 1, weldDate: '2026-09-01', pstoRequired: 'да', pstoResult: null },
      { id: 2, weldDate: '2026-09-01', pstoRequired: 'да', pstoRequest: 'Заявка', pstoResult: null },
      { id: 3, weldDate: '2026-09-01', pstoRequired: 'да', pstoResult: 'проведено',
        pstoRepeatCycles: [{ id: 31, weldJointId: 3, sequence: 2, pstoRequest: 'Повторная' }] },
    ]
    expect(sortReportRows(rows, { fieldKey: 'pstoResult', direction: 'asc' }, 'heatTreatment').map(row => row.id)).toEqual([2, 1, 3])
    expect(sortReportRows(rows, { fieldKey: 'pstoResult', direction: 'desc' }, 'heatTreatment').map(row => row.id)).toEqual([1, 2, 3])
    expect(rows.map(row => row.pstoResult)).toEqual([null, null, 'проведено'])
  })

  it.each(['source', 'derived'] as const)('PSTO %s path adds one page-scoped root query after metadata hydration', async path => {
    if (path === 'derived') mocks.query.mockResolvedValueOnce({ rows: sourceRows.map(row => [row.id, null]) })
    mocks.query.mockResolvedValueOnce({ rows: databaseRows(WELD_TABLE_SELECT) })
    const page = await listReportPage('heatTreatment', normalizeWeldPageRequest({
      includeTotals: false, pageSize: 100,
      columnFilters: path === 'derived' ? { pstoCycleSummary: 'Основной' } : {},
    }))
    expect(page.rows.map(row => row.id)).toEqual([1, 2])
    const rootQueries = mocks.query.mock.calls.filter(([query]) => query.text.includes('journal_physical_root'))
    expect(rootQueries).toHaveLength(1)
    expect(rootQueries[0][0].text).toContain('any(')
    expect(rootQueries[0][1].flat().sort()).toEqual([1, 2])
    expect(mocks.query.mock.calls.filter(([query]) => query.text.includes('journal_physical_root_state'))).toHaveLength(1)
  })

  it.each(['source', 'derived'] as const)('PSTO %s DTO keeps cancelled primary errors through client preparation and grouping', async path => {
    const stored: WeldRow[] = [{ id: 1, joint: 'F1', line: 'L', weldDate: '2026-09-01',
      pstoRequired: 'отменен', pstoRequest: 'ПСТО-1', pstoDate: '2026-09-02', pstoResult: 'ошибка',
      tvmtResult: 'не годен' },
    { id: 2, joint: 'F2', line: 'L', weldDate: '2026-09-01',
      pstoRequired: 'отменен', pstoRequest: 'ПСТО-2', pstoDate: '2026-09-02', pstoResult: 'проведено',
      tvmtResult: 'годен' }]
    if (path === 'derived') mocks.query.mockResolvedValueOnce({ rows: stored.map(row => [row.id, null]) })
    mocks.query.mockResolvedValueOnce({ rows: databaseRows(WELD_TABLE_SELECT, stored) })
    const page = await listReportPage('heatTreatment', normalizeWeldPageRequest({ includeTotals: false,
      columnFilters: path === 'derived' ? { pstoCycleSummary: 'Основной' } : {},
    }))
    expect(page.rows.map(row => row.pstoResult)).toEqual(['ошибка', 'проведено'])
    const prepared = prepareReportRows(page.rows, [], undefined, undefined, DEFAULT_OTHER_SETTINGS, true, true)
    expect(prepared.map(row => row.pstoResult)).toEqual(['ошибка', 'проведено'])
    expect(prepared.map(row => getPstoDisplayValue(row, 'pstoResult'))).toEqual(['отменен', 'проведено · назначение отменено'])
    const summary = createWeldGroupSummarizer(prepared, undefined, { heatTreatment: true })(prepared)
    expect(summary.pstoResult).toMatchObject({ status: 'ошибка', errors: 1 })
    expect(summary.tvmtResult).toMatchObject({ status: 'не годен', rejected: 1 })
    expect(stored.map(row => row.pstoResult)).toEqual(['ошибка', 'проведено'])
  })

  describe.each(['lnk', 'heatTreatment'] as const)('%s', report => {
    it.each([
      [100, 'desc'], ['all', 'desc'], [100, 'asc'], ['all', 'asc'],
    ] as const)('preserves SQL order through the %s fast path with joint %s', async (pageSize, direction) => {
      const orderedRows = direction === 'desc' ? sourceRows : [...sourceRows].reverse()
      // Full export first checks its fixed output limit, before reading cards.
      if (pageSize === 'all') mocks.query.mockResolvedValueOnce({ rows: [] })
      mocks.query.mockResolvedValueOnce({ rows: databaseRows(WELD_TABLE_SELECT, orderedRows) })
      const page = await listReportPage(report, normalizeWeldPageRequest({
        includeTotals: false, pageSize, search: 'F970', sort: { fieldKey: 'joint', direction },
      }))
      expect(page.rows.map(row => row.joint)).toEqual(orderedRows.map(row => row.joint))
      expect(page.rows.map(row => row.id)).toEqual(orderedRows.map(row => row.id))
      const rowQuery = mocks.query.mock.calls[pageSize === 'all' ? 1 : 0][0].text
      expect(rowQuery).toContain('order by')
      expect(rowQuery).toContain(`${direction} nulls last`)
      expect(page.hasMore).toBe(false)
      expect(page.acceptedWdiTotal).toBeUndefined()
      expect(page.availableRequestCount).toBeUndefined()
      for (const [query] of mocks.query.mock.calls) expect(query.text).not.toMatch(/count\(|sum\(/i)
    })

    it('applies derived selection before the bounded SQL-sorted page', async () => {
      mocks.query.mockResolvedValueOnce({ rows: sourceRows.map(row => [row.id, null]) })
      mocks.query.mockResolvedValueOnce({ rows: databaseRows(WELD_TABLE_SELECT) })
      const result = await listReportPage(report, normalizeWeldPageRequest({
        includeTotals: false, columnFilters: { preRkResult: '=ремонт' }, sort: { fieldKey: 'joint', direction: 'desc' },
      }))
      expect(result.rows.map(row => row.id)).toEqual([2, 1])
      const [query, params] = mocks.query.mock.calls[0]
      expect(query.text).toContain('"pre_heat_treatment_controls"')
      expect(query.text).toContain('limit')
      expect(params).toContain(101)
      expect(mocks.compute).toHaveBeenCalledOnce()
    })

    it('retains natural ordering of in-memory report rows', () => {
      expect(buildServerReportRows(sourceRows, report).map(row => row.id)).toEqual([1, 2])
    })
  })
})
