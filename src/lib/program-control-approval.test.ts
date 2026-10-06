import { describe, expect, it } from 'vitest'
import { calculateLineProgram } from './line-program-calculation'
import { programExcessEntries } from './line-program-workspace'
import { partitionProgramExcess, getProgramRemovalHints } from './line-program-excess'
import { programApprovalKey, parseStoredProgramApproval } from './program-control-approval'
import type { WeldRow } from './dispatcher-types'

const row: WeldRow = { id: 17, lineProgramId: 4, line: 'L1', joint: 'F1', connectionType: 'С17', weldDate: '2026-09-01', stamp1K: 'A', hasRk: 'да', hasUzk: 'да', hasPvk: 'да' }
describe('persistent approval of required method combinations', () => {
  it.each([[30, 50], [100, 50], [50, 30], [30, 100]])('retains %s → %s approval and excludes removal hints', (before, after) => {
    const approved = new Set(programExcessEntries(4, [row], calculateLineProgram([row], before, 10)).map(entry => entry.key))
    const changed = { ...row, line: 'Renamed', joint: 'F99', stamp1K: 'B', stamp2K: 'C' }
    const groups = calculateLineProgram([changed], after, 10)
    expect(partitionProgramExcess(programExcessEntries(4, [changed], groups), approved).pending).toEqual([])
    expect(getProgramRemovalHints(4, [changed], groups, approved).size).toBe(0)
    expect(programApprovalKey({ ...row, id: 18 }, 'common', true)).not.toBe(programApprovalKey(row, 'common', true))
  })
  it('does not couple RK/UZK to independent PVK or approve a different combination', () => {
    const key = programApprovalKey(row, 'common', true)
    expect(programApprovalKey({ ...row, hasPvk: 'отменен' }, 'common', true)).toBe(key)
    expect(programApprovalKey({ ...row, hasUzk: 'отменен' }, 'common', true)).not.toBe(key)
    expect(programApprovalKey({ ...row, layeredControlAssigned: true }, 'common', true)).not.toBe(key)
  })
  it('converts an existing legacy approval without its old quota or names', () => {
    const legacy = 'line-program-excess:' + JSON.stringify([4, 'a', 'common', true, 17, 30, 1, ['да', 'да', 'да', '']])
    expect(parseStoredProgramApproval(legacy)?.key).toBe(programApprovalKey(row, 'common', true))
    for (const key of ['unrelated', 'line-program-excess:[]', 'program-control:[17,"common",true,[]]']) expect(parseStoredProgramApproval(key)).toBeNull()
  })
})
