import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { captureProgramChainStates } from './line-program-chain-state'
import { buildProgramRepairRequirements, attachProgramRepairRequirements, buildProgramRepairTasks } from './line-program-repair-requirements'
import { getProgramAssignmentError } from './line-program-assignment-validation'
import { buildRepeatedJointDraft } from './repeated-joint-draft'
import { buildLineProgramTopology } from './line-program-topology'

const row = (id: number, joint: string, values: Partial<WeldRow> = {}): WeldRow => ({ id, joint,
  projectTitle: 'P', subtitleCode: 'S', line: 'L', connectionType: 'СШ', officiality: 'действующий',
  revisionActuality: 'актуальная', weldDate: '2026-09-01', stamp1K: 'A', hasVik: 'да', ...values })
const capture = (rows: WeldRow[]) => {
  const states = captureProgramChainStates(rows)
  return rows.map(item => ({ ...item, programChainState: states.get(item.id)! }))
}
const methods = (rows: WeldRow[], id: number, approved = new Set<string>()) =>
  buildProgramRepairRequirements(rows, approved).get(id)?.map(item => item.method).sort()

describe('inherited assignments, 4 November decision', () => {
  it.each([false, true])('inherits the immediate mixed predecessor, independently of failure method (saved: %s)', saved => {
    const input = [row(1, 'S63', { hasUzk: 'да' }), row(2, 'S63W1', { hasUzk: 'да' }),
      row(3, 'S63W1R1', { hasRk: 'дополнительный', hasUzk: 'да', hasPvk: 'отменен' }), row(4, 'S63W2R1')]
    const rows = saved ? capture(input) : input
    expect(methods(rows, 4)).toEqual(['ВИК', 'ПВК', 'РК', 'УЗК'].sort())
    expect(buildProgramRepairRequirements(rows).get(4)).toContainEqual(expect.objectContaining({ method: 'РК', sourceRowId: 3, assignment: 'дополнительный' }))
    expect(buildProgramRepairTasks(rows, new Set()).find(task => task.row.id === 4)?.values).toEqual(['ПВК', 'РК', 'УЗК'])
  })
  it('copies missing legacy bases without promoting additional or requiring a rejected result', () => {
    const source = row(1, 'F1', { hasRk: 'дополнительный', hasUzk: 'отменен' })
    expect(buildRepeatedJointDraft(source, 'F1R1')).toMatchObject({ hasRk: 'дополнительный', hasUzk: 'отменен' })
    const repair = attachProgramRepairRequirements([source, row(2, 'F1R1', { hasRk: 'дополнительный', hasUzk: 'отменен' })], new Set())[1]
    expect(() => getProgramAssignmentError(repair, { РК: '' })).not.toThrow()
    expect(getProgramAssignmentError(repair, { РК: '' })).toContain('унаследован')
  })
  it('does not infer assignments from old failed results or duplicate results alone', () => {
    const source = row(1, 'F1', { rkResult: 'ремонт', pvkResult: 'годен', duplicateControls: [
      { id: 1, weldJointId: 1, method: 'УЗК', result: 'ремонт', controlDate: '', conclusion: '', conclusionDate: '' },
    ] })
    expect(methods([source, row(2, 'F1R1')], 2)).toEqual(['ВИК'])
  })
  it('copies into a new coil without locking it; its repairs inherit only the coil side', () => {
    const source = row(1, 'F1', { hasRk: 'да', hasPvk: 'отменен' })
    const input = [source, row(2, 'F1Y1', { hasUzk: 'дополнительный' }), row(3, 'F1Y2'), row(4, 'F1Y1R1')]
    for (const rows of [input, capture(input)]) {
      expect(methods(rows, 2)).toBeUndefined()
      expect(methods(rows, 4)).toEqual(['ВИК', 'УЗК'])
      expect(buildRepeatedJointDraft(source, 'F1Y1')).toMatchObject({ hasRk: 'да', hasPvk: 'отменен' })
      expect(buildRepeatedJointDraft(rows[1], 'F1Y1R1')).toMatchObject({ hasUzk: 'дополнительный' })
    }
  })
})

describe('stable chain identity and physical replacement', () => {
  it('keeps replacement after deleting one or both coil rows', () => {
    const rows = capture([row(1, 'F1'), row(2, 'F1Y1'), row(3, 'F1Y2')])
    expect(buildLineProgramTopology(rows.slice(0, 2), false).physicalRows.map(item => item.id)).toEqual([2])
    expect(buildLineProgramTopology(rows.slice(0, 1), false).physicalRows).toEqual([])
    expect(capture(rows.slice(0, 1))[0].programChainState.replacedByCoil).toBe(true)
  })

  it('does not attach a surviving repair to a different object reusing its deleted source name', () => {
    const rows = capture([row(1, 'F1', { rkResult: 'ремонт' }), row(2, 'F1R1')])
    const next = [row(10, 'F1', { uzkResult: 'ремонт' }), rows[1]]
    expect(methods(next, 2)).toEqual(['ВИК'])
    expect(buildLineProgramTopology(next, false).issues[0].rowId).toBe(2)
  })

  it('survives missing middle repairs and renaming without moving inherited facts to another line', () => {
    const rows = capture([row(1, 'F1', { rkResult: 'ремонт' }), row(2, 'F1R1'), row(3, 'F1R2')])
    const next = [{ ...rows[0], joint: 'Renamed' }, rows[2]]
    expect(methods(next, 3)).toEqual(['ВИК']) // Missing saved parent is not replaced with an older failure.
    expect(methods([{ ...next[0], line: 'Other' }, next[1]], 3)).toEqual(['ВИК'])
  })

  it('bounds damaged cycles and does not fabricate a successful repair', () => {
    const rows = capture([row(1, 'F1'), row(2, 'F1R1'), row(3, 'F1R2')])
    rows[1].programChainState.sourceRowId = 3
    expect(methods(rows, 3)).toEqual(['ВИК'])
  })
})
