import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { calculateLineProgram } from './line-program-calculation'
import { captureProgramChainStates } from './line-program-chain-state'
import { buildLineProgramTopology } from './line-program-topology'
import { programApprovalKey } from './program-control-approval'
import { getProgramRemovalHints, projectProgramExcess } from './line-program-excess'
import { buildPercentageLineControlTasks } from './percentage-line-tasks'
import { previewProgramChanges } from './line-program-workspace'
import { getProgramApprovalOptions } from './program-approval-actions'
import { parseDispatcherTaskIndexPayload, serializeDispatcherTaskIndexPayload } from './dispatcher-task-index-payload'
import { buildDispatcherTaskCodeIndexRows, buildMergedDispatcherTaskCodes } from './dispatcher-task-row-codes'
import { buildProgramRepairRequirements, buildProgramRepairTasks } from './line-program-repair-requirements'
import { buildRepeatedJointDraft } from './repeated-joint-draft'
import { isLineProgramFinished, summarizeLineProgram } from './line-program-overview'

const row = (id: number, patch: Partial<WeldRow> = {}): WeldRow => ({
  id, joint: `F${id}`, projectTitle: 'P', subtitleCode: 'S', line: 'L',
  connectionType: 'С17', officiality: 'действующий', revisionActuality: 'актуальная',
  category: 'II', groupName: 'A', weldControlPercent: 10, pvkControlPercent: 0,
  weldDate: '2026-09-01', stamp1K: 'A', hasVik: 'да', ...patch,
})

describe('independent precommit counterexamples from the agreed plan', () => {
  it.each([
    { officiality: 'неофициальный' },
    { revisionActuality: 'не актуален' },
    { officiality: 'неофициальный', revisionActuality: 'не актуален' },
  ])('suspends only active repair warnings while excluded: %j', excluded => {
    const root = row(1, { uzkResult: 'ремонт' })
    const repair = row(2, { joint: 'F1R1', ...excluded })
    const tasks = buildProgramRepairTasks([root, repair], new Set())
    expect(tasks).toEqual([])
    expect(buildProgramRepairRequirements([root, repair]).get(2)?.map(item => item.method)).toEqual(['ВИК', 'УЗК'])
    const restored = { ...repair, officiality: null, revisionActuality: null }
    const restoredTasks = buildProgramRepairTasks([root, restored], new Set())
    expect(restoredTasks.map(task => [task.row.id, task.systemWarningCode, task.values])).toEqual([[2, 'СП-03', ['УЗК']]])
    const saved = parseDispatcherTaskIndexPayload(serializeDispatcherTaskIndexPayload(restoredTasks)).tasks
    const indexed = buildDispatcherTaskCodeIndexRows(saved, [root, restored])
    expect(indexed).toEqual([{ rowId: 2, taskKey: 'code:СП-03', code: 'СП-03' }])
    expect([...buildMergedDispatcherTaskCodes(indexed, []).allByRowId]).toEqual([[2, 'СП-03']])
    expect(buildProgramRepairTasks([root, { ...restored, hasUzk: 'да' }], new Set())).toEqual([])
  })

  it.each([false, true])('a new official same-name repair inherits the source, not the excluded namesake (pair=%s)', pair => {
    const root = row(1, { joint: 'S1', hasUzk: 'да', uzkResult: 'ремонт', hasRk: pair ? 'да' : null })
    const unofficial = row(2, { joint: 'S1R1', officiality: 'неофициальный', pvkResult: 'ремонт' })
    const approved = new Set(pair ? [programApprovalKey(root, 'common', true)] : [])
    const draft = buildRepeatedJointDraft(root, 'S1R1', { rows: [root, unofficial], approved })
    expect(draft).toMatchObject({ hasVik: 'да', hasUzk: 'да', hasRk: pair ? 'да' : null, pvkResult: null, uzkResult: null, officiality: null })
    const newRow = { ...draft, id: 3 }
    const states = captureProgramChainStates([root, unofficial, newRow])
    expect(states.get(3)).toMatchObject({ physicalRootId: 1, sourceRowId: 1 })
    expect(buildProgramRepairRequirements([root, unofficial, newRow], approved).get(3)?.map(item => item.method).sort()).toEqual((pair ? ['ВИК', 'РК', 'УЗК'] : ['ВИК', 'УЗК']).sort())
  })

  it('attributes quota surplus to the ordinary joint when another joint requires an approved pair', () => {
    // Plan §8/14: both approved methods are necessary independently of the percentage.
    // Two connections at 10% require one place. The pair covers that place;
    // the unprotected assignment is the only removable surplus.
    const rows = [row(1, { hasRk: 'да' }), row(2, { hasRk: 'да', hasUzk: 'да' })]
    const approved = new Set([programApprovalKey(rows[1], 'common', true)])
    const groups = calculateLineProgram(rows, 10, 0, undefined, approved)
    const visible = projectProgramExcess(1, rows, groups, approved)
    expect(visible[0].common.excessAssignments).toEqual([{ rowId: 1, method: 'РК', duplicate: false }])
    expect([...getProgramRemovalHints(1, rows, groups, approved).keys()]).toEqual([1])
    const program = { id: 1, weldControlPercent: 10, pvkControlPercent: 0 }
    expect(getProgramApprovalOptions(rows, program, [{ rowId: 2, key: [...approved][0], version: '1' }]).approve
      .map(option => [option.rowId, option.duplicate])).toEqual([[1, false]])
    const preview = previewProgramChanges([{ ...rows[0], hasRk: null }, rows[1]], [{ id: 1, values: { РК: 'да' } }], program, undefined, approved)
    expect(preview.newExcess.map(entry => [entry.rowId, entry.method])).toEqual([[1, 'РК']])
    const tasks = buildPercentageLineControlTasks(rows, [], undefined, approved).filter(task => task.issue === 'excess')
    expect(tasks.map(task => task.targetRowIds)).toEqual([[1]])
    const saved = parseDispatcherTaskIndexPayload(serializeDispatcherTaskIndexPayload(tasks)).tasks
    expect(saved).toEqual(tasks)
    const indexed = buildDispatcherTaskCodeIndexRows(saved, rows)
    expect(indexed).toEqual([1, 2].map(rowId => ({ rowId, taskKey: 'code:ДЗ-02', code: 'ДЗ-02' })))
    expect([...buildMergedDispatcherTaskCodes(indexed, []).allByRowId]).toEqual([[1, 'ДЗ-02'], [2, 'ДЗ-02']])
  })

  it('reports incomplete physical history after both sides of a completed coil have been deleted', () => {
    // Plan §16/17: a deleted row does not undo replacement; insufficient history
    // must be visible rather than silently presenting an intact closed process.
    const rows = [row(1), row(2, { joint: 'F1Y1' }), row(3, { joint: 'F1Y2' })]
    const states = captureProgramChainStates(rows)
    const remaining = [{ ...rows[0], programChainState: states.get(1) }]
    const topology = buildLineProgramTopology(remaining, false)
    expect(topology.physicalRows).toEqual([])
    expect(topology.issues.some(issue => issue.rowId === 1)).toBe(true)
  })

  it('does not mark a line complete while a saved replacement contradicts the corrected coil history', () => {
    // Plan: insufficient physical history must not manufacture successful completion.
    // This checks the indicator, not the still-pending choice of rollback mechanism.
    const goodRows = Array.from({ length: 24 }, (_, index) => row(index + 1, { hasRk: 'да', rkResult: 'годен', vikResult: 'годен' }))
    const before = [{ ...goodRows[0], rkResult: 'вырез' }, ...goodRows.slice(1),
      row(25, { joint: 'F1Y1' }), row(26, { joint: 'F1Y2' })]
    const states = captureProgramChainStates(before)
    const corrected = goodRows.map(item => ({ ...item, programChainState: states.get(item.id) }))
    expect(buildLineProgramTopology(corrected, false).issues.some(issue => issue.rowId === 1)).toBe(true)
    const overview = summarizeLineProgram(corrected, { id: 1, line: 'L', projectTitle: 'P', subtitleCode: 'S',
      category: 'II', groupName: 'A', weldControlPercent: 10, pvkControlPercent: 0, configurationIssue: null, version: '1' })
    expect(isLineProgramFinished(overview)).toBe(false)
  })
})
