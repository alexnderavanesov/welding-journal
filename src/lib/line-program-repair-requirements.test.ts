import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { captureProgramChainStates } from './line-program-chain-state'
import { buildProgramRepairRequirements, attachProgramRepairRequirements, buildProgramRepairTasks } from './line-program-repair-requirements'
import { programApprovalKey } from './program-control-approval'
import { getProgramApprovalOptions } from './program-approval-actions'
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

describe('mandatory repair controls, independent of percentage credit', () => {
  it.each(['ВИК', 'ПВК'] as const)('inherits the complete approved pair after rejected %s', method => {
    const source = row(1, 'F1', { hasRk: 'да', hasUzk: 'да', [method === 'ВИК' ? 'vikResult' : 'pvkResult']: 'ремонт' })
    const rows = [source, row(2, 'F1R1')]
    const approved = new Set([programApprovalKey(source, 'common', true)])
    expect(methods(rows, 2, approved)).toEqual((method === 'ВИК' ? ['ВИК', 'РК', 'УЗК'] : ['ВИК', 'ПВК', 'РК', 'УЗК']).sort())
    expect(methods(rows, 2)).toEqual((method === 'ВИК' ? ['ВИК'] : ['ВИК', 'ПВК']).sort())
    expect(getProgramApprovalOptions(rows, { id: 1, weldControlPercent: 0, pvkControlPercent: 0 }, []).approve).toContainEqual({ key: programApprovalKey(source, 'common', true), rowId: 1, duplicate: true, kind: 'common' })
  })

  it('retains earlier RK and good own PVK through a later VIK rejection, including mixed saved/raw context', () => {
    const rows = capture([row(1, 'F1', { rkResult: 'ремонт', pvkResult: 'годен' }), row(2, 'F1R1', { vikResult: 'ремонт' })])
    rows.push(row(3, 'F1R2') as typeof rows[number])
    expect(methods(rows, 3)).toEqual(['ВИК', 'ПВК', 'РК'].sort())
    const draft = buildRepeatedJointDraft(rows[1], 'F1R2', { rows: rows.slice(0, 2) })
    expect(draft).toMatchObject({ hasVik: 'да', hasPvk: 'да', hasRk: 'да', vikResult: null, pvkResult: null, rkResult: null, duplicateControls: [] })
  })

  it('uses a rejected duplicate method but not a good duplicate as own PVK history', () => {
    const source = row(1, 'F1', { duplicateControls: [
      { id: 1, weldJointId: 1, method: 'УЗК', result: 'ремонт', controlDate: '', conclusion: '', conclusionDate: '' },
      { id: 2, weldJointId: 1, method: 'ПВК', result: 'годен', controlDate: '', conclusion: '', conclusionDate: '' },
    ] })
    expect(methods([source, row(2, 'F1W1')], 2)).toEqual(['ВИК', 'УЗК'].sort())
  })

  it('late approval creates SP-03 without rewriting existing assignments, and can be fixed incrementally', () => {
    const source = row(1, 'F1', { hasRk: 'да', hasUzk: 'да', pvkResult: 'ремонт' })
    const rows = [source, row(2, 'F1R1', { hasPvk: 'да' }), row(3, 'F1R2', { hasPvk: 'да' })]
    const approved = new Set([programApprovalKey(source, 'common', true)])
    expect(buildProgramRepairTasks(rows, approved).map(task => [task.systemWarningCode, task.row.id, task.values])).toEqual([
      ['СП-03', 2, ['РК', 'УЗК']], ['СП-03', 3, ['РК', 'УЗК']],
    ])
    const repair = attachProgramRepairRequirements(rows, approved)[1]
    expect(getProgramAssignmentError(repair, { РК: 'да' })).toBe('')
    expect(getProgramAssignmentError({ ...repair, hasRk: 'да' }, { РК: '' })).toContain('снять или отменить')
    expect(rows[1].hasRk).toBeUndefined()
  })

  it('ordinary copied RK is removable after VIK failure and is not a mandatory repair method', () => {
    const repair = attachProgramRepairRequirements([row(1, 'F1', { vikResult: 'ремонт', hasRk: 'да' }), row(2, 'F1R1', { hasRk: 'да' })], new Set())[1]
    expect(getProgramAssignmentError(repair, { РК: '' })).toBe('')
    expect(getProgramAssignmentError(repair, { ВИК: '' })).toContain('ВИК обязателен')
  })

  it('does not pass an obligation into a coil or a sibling branch', () => {
    const rows = [row(1, 'F1', { rkResult: 'ремонт' }), row(2, 'F1R1', { pvkResult: 'ремонт' }), row(3, 'F1W1'), row(4, 'F1Y1')]
    expect(methods(rows, 3)).toEqual(['ВИК', 'РК'].sort())
    expect(methods(rows, 4)).toBeUndefined()
  })

  it.each([false, true])('does not resurrect the cut-out connection obligations on a coil repair (saved identities: %s)', saved => {
    const source = row(1, 'F1', { rkResult: 'ремонт', pvkResult: 'годен', hasRk: 'да', hasUzk: 'да' })
    const input = [source, row(2, 'F1R1', { rkResult: 'вырез' }),
      row(3, 'F1Y1', { vikResult: 'ремонт', hasRk: null, hasUzk: null, hasPvk: null }), row(4, 'F1Y2', { vikResult: 'годен' }), row(5, 'F1Y1R1')]
    const rows = saved ? capture(input) : input
    const approved = new Set([programApprovalKey(source, 'common', true)])

    // The coil is a new physical connection. Its repair inherits its own VIK
    // failure, not RK, good PVK or an approved pair of the removed connection.
    expect(methods(rows, 5, approved)).toEqual(['ВИК'])
    expect(buildProgramRepairTasks(rows, approved).filter(task => task.row.id === 5)).toEqual([])
    const repair = attachProgramRepairRequirements(rows, approved).find(row => row.id === 5)!
    expect(getProgramAssignmentError({ ...repair, hasRk: 'да' }, { РК: '' })).toBe('')
    expect(buildRepeatedJointDraft(rows[2], 'F1Y1R1', { rows: rows.slice(0, 4), approved })).toMatchObject({ hasRk: null, hasUzk: null, hasPvk: null })
  })

  it('inherits failures and good PVK of the coil itself through its subsequent repairs', () => {
    const rows = capture([row(1, 'F1', { rkResult: 'вырез' }),
      row(2, 'F1Y1', { uzkResult: 'ремонт', pvkResult: 'годен' }), row(3, 'F1Y2'),
      row(4, 'F1Y1R1', { vikResult: 'ремонт' }), row(5, 'F1Y1R2')])
    expect(methods(rows, 5)).toEqual(['ВИК', 'ПВК', 'УЗК'].sort())
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
    expect(methods(next, 3)).toEqual(['ВИК', 'РК'].sort())
    expect(methods([{ ...next[0], line: 'Other' }, next[1]], 3)).toEqual(['ВИК'])
  })

  it('bounds damaged cycles and does not fabricate a successful repair', () => {
    const rows = capture([row(1, 'F1'), row(2, 'F1R1'), row(3, 'F1R2')])
    rows[1].programChainState.sourceRowId = 3
    expect(methods(rows, 3)).toEqual(['ВИК'])
  })
})
