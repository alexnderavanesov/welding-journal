import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { appSettings, weldJoints, weldJointProgramStates } from '@/db/schema'
import { computeStatisticsServerResult } from './statistics'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'

const state = vi.hoisted(() => ({ rows: [] as WeldRow[], tables: [] as unknown[],
  select: vi.fn(), selectDistinct: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ select: state.select, selectDistinct: state.selectDistinct }) }))

function from(table: unknown, distinct = false) {
  state.tables.push(table)
  const rows = distinct ? [] : table === weldJoints ? state.rows : table === weldJointProgramStates
    ? state.rows.map(row => ({ weldJointId: row.id, kind: 'primary', physicalRootId: row.id,
      sourceRowId: null, coilParentId: null, coilSide: null, replacedByCoil: row.id === 1 }))
    : table === appSettings ? [{ key: PROJECT_SETTING_KEYS.other, value: JSON.stringify({ wdiCalculationMode: 'formula' }) }] : []
  const query = Object.assign(Promise.resolve(rows), { where: () => query, orderBy: () => query, innerJoin: () => query })
  return query
}

beforeEach(() => {
  vi.clearAllMocks(); state.tables = []
  state.select.mockImplementation(() => ({ from: (table: unknown) => from(table) }))
  state.selectDistinct.mockImplementation(() => ({ from: (table: unknown) => from(table, true) }))
})

describe('physical statistics bounded loading', () => {
  it.each([1, 1000])('loads %i rows and saved cut facts in five reads without unrelated control histories', async count => {
    state.rows = Array.from({ length: count }, (_, index) => ({ id: index + 1, joint: `S${index + 1}`, line: 'L',
      weldDate: '2026-09-01', connectionType: 'С17', d1: '50.8', wdi: '999', weldControlPercent: '10' })) as WeldRow[]
    const result = await computeStatisticsServerResult({ tab: 'lineSummary', unit: 'wdi' })
    expect(result.lineSummary.total).toBe((count - 1) * 2)
    expect(result.lineSummary.completed).toBe((count - 1) * 2)
    expect(state.tables).toHaveLength(5)
    expect(state.tables.filter(table => table === weldJointProgramStates)).toHaveLength(1)
    expect(state.tables.every(table => [weldJoints, appSettings, weldJointProgramStates].includes(table as never))).toBe(true)
  })
  it.each(['general', 'lnk', 'psto', 'welders'] as const)('preserves control-history loading for %s, attaching topology only when used', async tab => {
    state.rows = [{ id: 1, joint: 'S1', line: 'L', weldDate: '2026-09-01' } as WeldRow]
    await computeStatisticsServerResult({ tab, unit: 'joints' })
    expect(state.tables).toHaveLength(tab === 'general' || tab === 'welders' ? 8 : 7)
    expect(state.tables.filter(table => table === weldJointProgramStates)).toHaveLength(tab === 'general' ? 1 : 0)
  })
})
