import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { sql } from 'drizzle-orm'
import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'

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
  getFullReportRowsByIds,
  listDerivedReportRowIds,
  listReportPage,
  normalizeWeldPageRequest,
  REPORT_DERIVED_FILTER_SELECT,
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

    it('preserves SQL order in the derived ID cache, before pagination', async () => {
      mocks.query.mockResolvedValueOnce({ rows: databaseRows(REPORT_DERIVED_FILTER_SELECT) })
      const ids = await listDerivedReportRowIds(report, normalizeWeldPageRequest({
        sort: { fieldKey: 'joint', direction: 'desc' },
      }), sql`true`)
      expect(ids).toEqual([2, 1])
    })

    it('keeps the existing ID-order restoration and default report ordering', async () => {
      mocks.query.mockResolvedValueOnce({ rows: databaseRows(WELD_TABLE_SELECT, [...sourceRows].reverse()) })
      const rows = await getFullReportRowsByIds([2, 1], report)
      expect(rows.map(row => row.id)).toEqual([2, 1])
      expect(buildServerReportRows(sourceRows, report).map(row => row.id)).toEqual([1, 2])
    })
  })
})
