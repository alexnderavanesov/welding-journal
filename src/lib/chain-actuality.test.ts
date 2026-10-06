import { describe, expect, it } from 'vitest'
import { buildChainActualityGroups } from './chain-actuality'
import { buildChainActualityCheckTasks } from './chain-actuality-check'
import { captureProgramChainStates } from './line-program-chain-state'
import type { WeldRow } from './dispatcher-types'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import { summarizeLineProgram } from './line-program-overview'
import { getEarlyCoilDecisionKey } from './early-coil-decision'

const row = (id: number, joint: string, values: Partial<WeldRow> = {}): WeldRow => ({ id, joint, line: 'L', weldDate: '2026-09-01', ...values })
describe('actuality follows the physical connection, not the whole replacement tree', () => {
  it('uses configured indexes for legacy rows before stable IDs have been captured', () => {
    const rows = [row(1, 'S1'), row(2, 'S1Q1', { revisionActuality: 'не актуален' }), row(3, 'S1Q1C1'), row(4, 'S1K1'), row(5, 'S1K1Q1'), row(6, 'S1K2')]
    const settings = { ...DEFAULT_SYSTEM_INDEX_SETTINGS, repair: 'Q', cutout: 'C', coil: 'K' }
    expect(buildChainActualityGroups(rows, settings).groups.map(group => group.rows.map(row => row.id))).toEqual([[1, 2, 3], [4, 5], [6]])
    expect(buildChainActualityCheckTasks(rows, settings).map(task => task.actualityRowIds)).toEqual([[1, 2, 3]])
  })
  it('counts 2 → 2 → 1 → 2 → 2 through exclusion/restoration without reviving a cut root', () => {
    const good = { connectionType: 'С17', stamp1K: 'A', hasVik: 'да', vikResult: 'годен', hasUzk: 'да', uzkResult: 'годен' }
    let rows = [row(1, 'S1', { ...good, uzkResult: 'ремонт' }), row(2, 'S1R1', { ...good, uzkResult: 'вырез' }),
      row(3, 'S1Y1', { ...good, uzkResult: 'ремонт' }), row(4, 'S1Y1R1', good), row(5, 'S1Y2', good)]
    const states = captureProgramChainStates(rows)
    rows = rows.map(row => ({ ...row, programChainState: states.get(row.id) }))
    const line = { id: 1, projectTitle: '', subtitleCode: '', line: 'L', category: 'II', groupName: 'A', weldControlPercent: 10, pvkControlPercent: 0, configurationIssue: null, version: '1' }
    const accepted = new Set([getEarlyCoilDecisionKey(2)])
    for (const [id, active, quantity] of [[1, true, 2], [1, false, 2], [4, false, 1], [3, true, 2], [2, true, 2]] as const) {
      const groupIds = new Set(buildChainActualityGroups(rows).groups.find(group => group.rows.some(row => row.id === id))!.rows.map(row => row.id))
      rows = rows.map(row => groupIds.has(row.id) ? { ...row, revisionActuality: active ? null : 'не актуален' } : row)
      expect(summarizeLineProgram(rows, line, accepted)).toMatchObject({ joints: quantity, calculationJoints: quantity, unfinishedChains: 0 })
      expect(buildChainActualityCheckTasks(rows)).toEqual([])
      expect(rows[0].programChainState?.replacedByCoil).toBe(true)
    }
  })
  it('includes unofficial namesakes but separates original, both coil sides, and a nested coil', () => {
    const rows = [row(1, 'S1', { officiality: 'неофициальный', revisionActuality: 'не актуален' }), row(2, 'S1'),
      row(3, 'S1R1'), row(4, 'S1R2'), row(5, 'S1R2W1'), row(6, 'S1Y1'), row(7, 'S1Y1R1'),
      row(8, 'S1Y2'), row(9, 'S1Y2R1'), row(10, 'S1Y1Y1'), row(11, 'S1Y1Y2')]
    expect(buildChainActualityGroups(rows).groups.map(group => group.rows.map(row => row.id))).toEqual([[1, 2, 3, 4, 5], [6, 7], [8, 9], [10], [11]])
    expect(buildChainActualityCheckTasks(rows).map(task => task.actualityRowIds)).toEqual([[1, 2, 3, 4, 5]])
    for (const active of [false, true, false, true]) {
      for (const member of rows.slice(0, 5)) member.revisionActuality = active ? null : 'не актуален'
      expect(buildChainActualityCheckTasks(rows)).toEqual([])
      expect(rows.slice(5).every(row => !row.revisionActuality)).toBe(true)
    }
  })
  it('keeps saved membership through renaming, including renamed unofficial history', () => {
    const rows = [row(1, 'S1'), row(2, 'S1R1', { officiality: 'неофициальный' }), row(3, 'S1R1'), row(4, 'S1Y1'), row(5, 'S1Y2')]
    const states = captureProgramChainStates(rows)
    const renamed = rows.map(row => ({ ...row, joint: `RENAMED${row.id}`, programChainState: states.get(row.id), revisionActuality: row.id === 2 ? 'не актуален' : null }))
    expect(buildChainActualityCheckTasks(renamed).map(task => task.actualityRowIds)).toEqual([[1, 2, 3]])
  })
  it('does not join empty names or other line/project namespaces', () => {
    expect(buildChainActualityCheckTasks([row(1, ''), row(2, '', { revisionActuality: 'не актуален' })])).toEqual([])
    expect(buildChainActualityCheckTasks([row(1, 'S1'), row(2, 'S1', { revisionActuality: 'не актуален', projectTitle: 'Other' })])).toEqual([])
  })
  it('handles 200000 persisted records with bounded ancestry reads and one task per mixed connection', () => {
    let reads = 0
    const rows = Array.from({ length: 200_000 }, (_, i) => row(i + 1, `S1R${i}`, {
      revisionActuality: i === 100_000 ? 'не актуален' : null,
      programChainState: { weldJointId: i + 1, kind: i ? 'repair' : 'primary', physicalRootId: 1,
        get sourceRowId() { reads++; return i || null }, coilParentId: null, coilSide: null, replacedByCoil: false },
    }))
    const tasks = buildChainActualityCheckTasks(rows)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].actualityRowIds).toHaveLength(rows.length)
    expect(reads).toBeLessThanOrEqual(rows.length * 2)
  }, 15_000)
})
