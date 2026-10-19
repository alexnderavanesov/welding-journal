import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { WeldJoint } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'

const mocks = vi.hoisted(() => ({ query: vi.fn(), compute: vi.fn(), attach: vi.fn() }))
vi.mock('@/db', async () => {
  const { drizzle } = await import('drizzle-orm/node-postgres')
  return { requireDb: () => drizzle({ client: { query: mocks.query } as unknown as Pool }) }
})
vi.mock('@/server/derived-calculation-cache', () => ({ getOrComputeDerivedCalculation: mocks.compute }))
vi.mock('@/server/heat-treatment-control-relations', () => ({
  attachHeatTreatmentControlRelations: mocks.attach,
  attachPreHeatTreatmentControlRelations: mocks.attach,
}))
vi.mock('@/server/weld-server-shared', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/weld-server-shared')>(),
  loadServerOtherSettings: async () => DEFAULT_OTHER_SETTINGS,
}))

import {
  buildReportSourceWhere, buildWeldReportPageFromRows, canPaginateReportSource, getReportOrderBy,
  listColumnFilterOptions, listDerivedReportRowIds, normalizeWeldColumnFilterOptionsRequest,
  normalizeWeldPageRequest, getReportDerivedFilterSelect,
} from './weld-read'

const dialect = new PgDialect()
const sourceRows: WeldRow[] = [
  { id: 1, weldDate: '2026-09-01', pstoRequired: 'да', pstoDate: '2026-09-01', tvmtResult: 'не годен', pstoRepeatCycles: [
    { id: 11, weldJointId: 1, sequence: 2, pstoDate: '2026-10-02', tvmtResult: 'годен' },
  ] },
  { id: 2, weldDate: '2026-09-01', pstoRequired: 'да', pstoDate: '2026-09-04', tvmtResult: 'годен', pstoRepeatCycles: [
    { id: 21, weldJointId: 2, sequence: 2, pstoDate: '2026-10-01', tvmtResult: 'не годен' },
  ] },
]

describe('PSTO server selection uses the displayed current cycle', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.query.mockResolvedValue({ rows: [] })
    mocks.compute.mockImplementation((_key, compute) => compute())
    mocks.attach.mockImplementation(async (rows: WeldRow[]) => rows.map(row => ({
      ...row, pstoRepeatCycles: sourceRows.find(source => source.id === row.id)?.pstoRepeatCycles ?? [],
    })))
  })

  it('pages SQL cycle filters in PSTO while preserving the other profiles', () => {
    const columnFilters = { tvmtResult: '=годен', pstoDate: '=2026-10-02', pstoNote: '=повтор' }
    expect(canPaginateReportSource(columnFilters, 'heatTreatment')).toBe(true)
    expect(canPaginateReportSource(columnFilters, 'lnk')).toBe(false)
    const query = dialect.sqlToQuery(buildReportSourceWhere({ columnFilters }, 'heatTreatment')!)
    expect(query.sql).toContain('"psto_display_cycles"')
    expect(query.params).toEqual(expect.arrayContaining(['годен', '2026-10-02', 'повтор']))
    const lnkQuery = dialect.sqlToQuery(buildReportSourceWhere({ columnFilters }, 'lnk')!)
    expect(lnkQuery.sql).not.toContain('"psto_display_cycles"')
    expect(lnkQuery.sql).toContain('"weld_joints"."psto_note"')
  })

  it.each(['asc', 'desc'] as const)('sorts current dates in SQL %s with empty repeat dates last', direction => {
    const query = dialect.sqlToQuery(sql.join(getReportOrderBy('heatTreatment', { fieldKey: 'pstoDate', direction }), sql`, `))
    expect(query.sql).toContain('"psto_display_cycles"')
    expect(query.sql).toContain('nullif(')
    expect(query.sql).toContain(`${direction} nulls last`)
    for (const report of ['weldingJournal', 'lnk'] as const) {
      expect(dialect.sqlToQuery(sql.join(getReportOrderBy(report, { fieldKey: 'pstoDate', direction }))).sql).not.toContain('"psto_display_cycles"')
    }
  })

  it('preserves raw primary values in filtered and sorted report pages', () => {
    const source = structuredClone(sourceRows)
    const result = buildWeldReportPageFromRows(source as WeldJoint[], normalizeWeldPageRequest({
      columnFilters: { tvmtResult: '=годен' }, sort: { fieldKey: 'pstoDate', direction: 'asc' },
    }), 'heatTreatment')
    expect(result.rows.map(row => row.id)).toEqual([1])
    expect(result.rows[0]).toMatchObject({ pstoDate: '2026-09-01', tvmtResult: 'не годен' })
    expect(source).toEqual(sourceRows)
    const sorted = buildWeldReportPageFromRows(source as WeldJoint[], normalizeWeldPageRequest({
      sort: { fieldKey: 'pstoDate', direction: 'asc' },
    }), 'heatTreatment')
    expect(sorted.rows.map(row => row.id)).toEqual([2, 1])
  })

  it('uses current values again in the derived ID branch', async () => {
    const columnFilters = { tvmtResult: '=годен', pstoCycleSummary: 'Повтор #2' }
    const select = getReportDerivedFilterSelect(undefined, { report: 'heatTreatment', columnFilters })
    mocks.query.mockResolvedValueOnce({ rows: sourceRows.map(row =>
      Object.keys(select).map(key => row[key as keyof WeldRow] ?? null),
    ) })
    const ids = await listDerivedReportRowIds('heatTreatment', normalizeWeldPageRequest({
      columnFilters,
    }), sql`true`)
    expect(ids).toEqual([1])
    expect(sourceRows[0].tvmtResult).toBe('не годен')
  })

  it('aggregates current-cycle facet values in a single scoped SQL query', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [['годен', 4], ['', 2]] })
    const options = await listColumnFilterOptions(normalizeWeldColumnFilterOptionsRequest({
      report: 'heatTreatment', fieldKey: 'tvmtResult', columnFilters: { line: '=Линия', tvmtResult: '=собственный фильтр' },
    }))
    expect(options).toEqual(expect.arrayContaining([
      { value: 'годен', label: 'годен', count: 4 }, { value: '', label: '(пусто)', count: 2 },
    ]))
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.attach).not.toHaveBeenCalled()
    const [config, params] = mocks.query.mock.calls[0]
    expect(config.text).toContain('"psto_display_cycles"')
    expect(config.text).toContain('group by 1')
    expect(params).toContain('Линия')
    expect(params).not.toContain('собственный фильтр')
  })

  it('uses current filter and facet values together in the derived options branch', async () => {
    const columnFilters = { pstoCycleSummary: 'Повтор #2', pstoDate: '=2026-10-02' }
    const select = getReportDerivedFilterSelect('tvmtResult', { report: 'heatTreatment', columnFilters })
    mocks.query.mockResolvedValueOnce({ rows: sourceRows.map(row =>
      Object.keys(select).map(key => row[key as keyof WeldRow] ?? null),
    ) })
    const options = await listColumnFilterOptions(normalizeWeldColumnFilterOptionsRequest({
      report: 'heatTreatment', fieldKey: 'tvmtResult',
      columnFilters,
    }))
    expect(options).toEqual([{ value: 'годен', label: 'годен', count: 1 }])
    expect(sourceRows[0]).toMatchObject({ pstoDate: '2026-09-01', tvmtResult: 'не годен' })
  })

  it('loads free-text notes only for an explicit PSTO filter or requested facet', () => {
    expect(getReportDerivedFilterSelect()).not.toHaveProperty('pstoNote')
    expect(getReportDerivedFilterSelect(undefined, { report: 'heatTreatment', columnFilters: { tvmtResult: '=годен' } })).not.toHaveProperty('pstoNote')
    expect(getReportDerivedFilterSelect(undefined, { report: 'weldingJournal', columnFilters: { pstoNote: '=заметка' } })).not.toHaveProperty('pstoNote')
    expect(getReportDerivedFilterSelect(undefined, { report: 'heatTreatment', columnFilters: { pstoNote: '=заметка' } })).toHaveProperty('pstoNote')
    expect(getReportDerivedFilterSelect('pstoNote', { report: 'heatTreatment', columnFilters: {} })).toHaveProperty('pstoNote')
  })

  it('keeps primary notes available when combined with a derived PSTO filter', async () => {
    const columnFilters = { pstoCycleSummary: 'Основной', pstoNote: '=Первичная заметка' }
    const source: WeldRow = { id: 3, weldDate: '2026-09-01', pstoRequired: 'да', pstoNote: 'Первичная заметка' }
    const select = getReportDerivedFilterSelect(undefined, { report: 'heatTreatment', columnFilters })
    mocks.query.mockResolvedValueOnce({ rows: [Object.keys(select).map(key => source[key as keyof WeldRow] ?? null)] })
    expect(await listDerivedReportRowIds('heatTreatment', normalizeWeldPageRequest({ columnFilters }), sql`true`)).toEqual([3])
  })

  it('uses the displayed cancellation and no-need labels in result SQL too', () => {
    const query = dialect.sqlToQuery(buildReportSourceWhere({ columnFilters: { pstoResult: '=нет потребности' } }, 'heatTreatment')!)
    expect(query.sql).toContain("then 'проведено · назначение отменено'")
    expect(query.sql).toContain("then 'нет потребности'")
    expect(query.sql).toContain('"duplicate_controls"')
    expect(query.sql).toContain('"pre_heat_treatment_controls"')
    expect(query.sql).toContain('"psto_display_current"."value"')
    expect(query.params).toContain('нет потребности')
  })
})
