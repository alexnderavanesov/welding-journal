import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { buildWeldColumnValueFilter } from '@/lib/weld-column-choice-filter'
import type { WeldRow } from '@/lib/dispatcher-types'

const state = vi.hoisted(() => ({
  rows: [] as WeldRow[], selects: [] as string[][],
  settings: {} as typeof DEFAULT_OTHER_SETTINGS,
  transaction: vi.fn(),
}))
vi.mock('@/db', () => {
  const db = {
    transaction: state.transaction,
    select: (projection: Record<string, unknown>) => {
      state.selects.push(Object.keys(projection))
      const rows = state.rows.map(row => Object.fromEntries(Object.keys(projection).map(key => [key, row[key as keyof WeldRow]])))
      return { from: () => ({ where: () => ({
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
        orderBy: async () => rows,
        groupBy: async () => [],
      }) }) }
    },
  }
  state.transaction.mockImplementation(async (run: (db: unknown) => unknown) => run(db))
  return { requireDb: () => db }
})
vi.mock('@/server/security-functions', () => ({ assertSecurityScope: vi.fn() }))
vi.mock('@/server/weld-server-shared', async original => ({
  ...await original<typeof import('@/server/weld-server-shared')>(),
  loadServerOtherSettings: async () => state.settings,
}))
vi.mock('@/server/heat-treatment-control-relations', () => ({ attachHeatTreatmentControlRelations: async (rows: unknown[]) => rows }))
vi.mock('./line-program-rule-context', () => ({ loadProgramRuleContext: async () => ({ rows: [], approved: new Set() }) }))
vi.mock('./line-program', () => ({ loadProgramSystemIndexSettings: async () => ({}) }))
vi.mock('@/lib/line-program-repair-requirements', () => ({ buildProgramRepairRequirements: () => new Map() }))

import { listWeldingJournalImportScope } from './weld-import'

describe('computed WDI import scope', () => {
  beforeEach(() => {
    state.selects = []
    state.transaction.mockClear()
    state.settings = { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula' }
    state.rows = []
  })
  it.each([0, 500, 501, 200_000])('checks all %i matches before loading any full cards', async count => {
    state.rows = Array.from({ length: count }, (_, i) => ({ id: i + 1, d1: 254, wdi: 777, joint: `F${i}` }) as WeldRow)
    const result = await listWeldingJournalImportScope({ data: { columnFilters: { wdi: '=10' } } })
    expect(result.total).toBe(count)
    expect(result.limitExceeded).toBe(count > 500)
    expect(result.rows).toHaveLength(count > 500 ? 0 : count)
    expect(state.selects[0]).toEqual(['id', 'connectionType', 'd1', 'd2', 't1', 't2', 'wdi', 'rowVersion'])
    expect(state.selects.filter(fields => fields.includes('joint'))).toHaveLength(count > 0 && count <= 500 ? 1 : 0)
    expect(state.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'repeatable read', accessMode: 'read only' })
    if (count === 500) expect(result.rows.every(row => row.wdi === 10)).toBe(true)
  })
  it('finds nothing by the stale stored WDI and does not read full cards', async () => {
    state.rows = [{ id: 1, d1: 254, wdi: 777 }] as WeldRow[]
    const result = await listWeldingJournalImportScope({ data: { columnFilters: { wdi: '=777' } } })
    expect(result.total).toBe(0)
    expect(state.selects.some(fields => fields.includes('joint'))).toBe(false)
  })
  it('matches an empty calculated WDI even when the stored value is nonempty', async () => {
    state.rows = [{ id: 1, wdi: 777 }] as WeldRow[]
    const result = await listWeldingJournalImportScope({ data: { columnFilters: { wdi: buildWeldColumnValueFilter(['']) } } })
    expect(result.total).toBe(1)
    expect(result.rows[0].wdi == null).toBe(true)
  })
  it.each(['=3.5', buildWeldColumnValueFilter(['3.5'])])('retains table-mode filtering: %s', async filter => {
    state.settings = { ...state.settings, wdiCalculationMode: 'table', wdiTable: { fileName: 'test.xlsx', uploadedAt: '', diameters: [100], thicknesses: [3], values: [[3.5]] } }
    state.rows = [{ id: 1, d1: 108, t1: 4, wdi: 777 }] as WeldRow[]
    const result = await listWeldingJournalImportScope({ data: { columnFilters: { wdi: filter } } })
    expect(result.total).toBe(1)
    expect(result.rows[0].wdi).toBe(3.5)
  })
})
