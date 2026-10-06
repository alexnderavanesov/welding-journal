import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { buildLnkOfficialityChainPlan } from './lnk-officiality-chain-plan'
import { captureProgramChainStates, captureRebuiltProgramChainStates } from './line-program-chain-state'
import { calculateLineProgram } from './line-program-calculation'
import { buildLineSummary } from './line-summary'
import { countUnfinishedProgramChains } from './line-program-completion'
import { buildProgramRepairRequirements } from './line-program-repair-requirements'

const root: WeldRow = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'S1',
  connectionType: 'С17', stamp1K: 'A', weldDate: '2026-09-01', hasVik: 'да', vikResult: 'годен', hasUzk: 'да', uzkResult: 'ремонт' }
const repair: WeldRow = { ...root, id: 2, joint: 'S1R1', weldDate: '2026-09-02', uzkResult: 'годен' }
function captured(rows: WeldRow[]) {
  const states = captureProgramChainStates(rows)
  return rows.map(row => ({ ...row, programChainState: states.get(row.id) }))
}
function applyOfficiality(rows: WeldRow[], id: number, officiality: 'official' | 'unofficial') {
  const plan = buildLnkOfficialityChainPlan(rows, [id], officiality)
  const next = rows.map(row => ({ ...row,
    ...(row.id === id ? { officiality: officiality === 'unofficial' ? 'неофициальный' : null } : {}),
    ...(plan.renames.some(change => change.rowId === row.id) ? { joint: plan.renames.find(change => change.rowId === row.id)!.targetJoint } : {}),
  }))
  const states = captureRebuiltProgramChainStates(next)
  return next.map(row => ({ ...row, programChainState: states.get(row.id) }))
}

describe('confirmed officiality rebuild changes computational roles, not facts', () => {
  it('keeps one primary connection and its credit after promoting the repair', () => {
    const before = captured([root, repair])
    const next = applyOfficiality(before, 1, 'unofficial')
    expect(next[1]).toMatchObject({ joint: 'S1', uzkResult: 'годен', programChainState: { kind: 'primary', physicalRootId: 2, sourceRowId: null } })
    expect(calculateLineProgram(next, 10, 0)[0]).toMatchObject({ rowIds: [2], rejectedRowIds: [], common: { coveredRowIds: [2] } })
    expect(buildLineSummary(next, 'joints')).toMatchObject({ total: 1, completed: 1 })
    expect(countUnfinishedProgramChains(next, false)).toBe(0)
    expect(buildProgramRepairRequirements(next).has(2)).toBe(false)
    expect(next.map(row => [row.id, row.weldDate, row.uzkResult])).toEqual(before.map(row => [row.id, row.weldDate, row.uzkResult]))
    const restored = applyOfficiality(next, 1, 'official')
    expect(restored[1]).toMatchObject({ joint: 'S1R1', uzkResult: 'годен', programChainState: { kind: 'repair', physicalRootId: 1, sourceRowId: 1 } })
    expect(buildLineSummary(restored, 'joints')).toMatchObject({ total: 1, completed: 1 })
    expect(countUnfinishedProgramChains(restored, false)).toBe(0)
    expect(buildProgramRepairRequirements(restored).get(2)?.map(item => item.method)).toEqual(['ВИК', 'УЗК'])
    // Independently: one physical connection at 10% gives base 1, the restored
    // primary rejection adds 2; only that same primary can count. R1 adds no
    // physical/percentage place, and no unavailable extra assignment is owed.
    expect(calculateLineProgram(restored, 10, 0)[0]).toMatchObject({ rowIds: [1], rejectedRowIds: [1],
      common: { baseRequired: 1, additionalRequired: 2, required: 3, actionableRequired: 1,
        coveredRowIds: [1], candidateRowIds: [], missing: 0 },
    })
  })

  it('a rebuilt official R1 inherits S1, not the excluded namesake, just like a newly created official R1', () => {
    const rows = captured([root, { ...repair, hasRk: 'да', uzkResult: 'годен', rkResult: 'ремонт' },
      { ...repair, id: 3, joint: 'S1R2', weldDate: '2026-09-03', hasRk: 'да', rkResult: 'годен' }])
    const next = applyOfficiality(rows, 2, 'unofficial')
    expect(next[2]).toMatchObject({ joint: 'S1R1', programChainState: { kind: 'repair', physicalRootId: 1, sourceRowId: 1 } })
    expect(buildProgramRepairRequirements(next).get(3)?.map(item => item.method)).toEqual(['ВИК', 'УЗК'])
    expect(countUnfinishedProgramChains(next, false)).toBe(0)
  })

  it('never clears a physical replacement even when both coil rows have been deleted', () => {
    const [source] = captured([root, { ...repair, id: 3, joint: 'S1Y1' }, { ...repair, id: 4, joint: 'S1Y2' }])
    expect(captureRebuiltProgramChainStates([source]).get(1)).toMatchObject({ replacedByCoil: true, replacementCoilIds: [3, 4] })
    expect(buildLineSummary([source], 'joints').total).toBe(0)
  })

  it('does not promote a replacement representative before explicit physical restoration', () => {
    const before = captured([root, repair, { ...repair, id: 3, joint: 'S1Y1' }, { ...repair, id: 4, joint: 'S1Y2' }]).slice(0, 2)
    // The operator deleted mistaken coil rows and corrected the final repair.
    // Changing officiality is not the separately confirmed restoration action.
    const next = [{ ...before[0], officiality: 'неофициальный' }, { ...before[1], joint: 'S1' }]
    expect(() => captureRebuiltProgramChainStates(next)).toThrow('восстановление')
  })
})
