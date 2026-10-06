import { describe, expect, it } from 'vitest'
import { buildLineConsistencyTasks } from './line-consistency-tasks'
import { buildPercentageLineControlTasks } from './percentage-line-tasks'
import { getDispatcherTaskCode, isDispatcherTaskEnabled, DEFAULT_DISPATCHER_SETTINGS } from './dispatcher-settings'
import { buildDispatcherTaskCodeIndexRows, buildMergedDispatcherTaskCodes } from './dispatcher-task-row-codes'
import { serializeDispatcherTaskIndexPayload, parseDispatcherTaskIndexPayload } from './dispatcher-task-index-payload'
import type { RepeatedJointTask, WeldRow } from './dispatcher-types'
import { calculateLineProgram } from './line-program-calculation'
import { programExcessEntries } from './line-program-workspace'
import { buildVisibleDispatcherTasks } from './dispatcher-task-builder'
import { DEFAULT_DISPATCHER_REMINDER_SETTINGS } from './dispatcher-settings'
import { buildProgramRepairTasks } from './line-program-repair-requirements'
import { programApprovalKey } from './program-control-approval'

const row = (id: number, extra: Partial<WeldRow> = {}): WeldRow => ({ id, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: `F${id}`, weldDate: '2026-09-01', connectionType: 'СШ', category: 'II', groupName: 'A', weldControlPercent: 30, pvkControlPercent: 10, stamp1K: 'A', hasVik: 'да', ...extra })
function indexed(tasks: RepeatedJointTask[], rows: WeldRow[]) {
  const savedTasks = parseDispatcherTaskIndexPayload(serializeDispatcherTaskIndexPayload(tasks)).tasks
  const storedIndex = buildDispatcherTaskCodeIndexRows(savedTasks, rows)
  return { savedTasks, storedIndex, virtual: buildMergedDispatcherTaskCodes(storedIndex, []).allByRowId }
}

describe('line-program rules through dispatcher persistence and virtual fields', () => {
  it('persists non-disableable SP-03 only on repairs missing required assignments, not the whole line', () => {
    const source = row(1, { hasRk: 'да', hasUzk: 'да', pvkResult: 'ремонт' })
    const rows = [source, row(2, { joint: 'F1R1', hasPvk: 'да', hasRk: 'да' }), row(3)]
    const tasks = buildProgramRepairTasks(rows, new Set([programApprovalKey(source, 'common', true)]))
    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('СП-03')
    expect(isDispatcherTaskEnabled(tasks[0], Object.fromEntries(Object.keys(DEFAULT_DISPATCHER_SETTINGS).map(key => [key, false])) as typeof DEFAULT_DISPATCHER_SETTINGS)).toBe(true)
    const result = indexed(tasks, rows)
    expect(result.storedIndex).toEqual([{ rowId: 2, taskKey: 'code:СП-03', code: 'СП-03' }])
    expect([...result.virtual]).toEqual([[2, 'СП-03']])
    rows[1].hasUzk = 'да'
    expect(buildProgramRepairTasks(rows, new Set([programApprovalKey(source, 'common', true)]))).toEqual([])
  })
  it('keeps joint/method approvals across quotas and names without approving other joints', () => {
    const rows = [row(1, { lineProgramId: 7, weldControlPercent: 100, hasRk: 'да', hasUzk: 'да', rkResult: 'годен', rkConclusion: 'RK-1', uzkResult: 'годен', uzkConclusion: 'UZ-1' })]
    const accepted = new Set(programExcessEntries(7, rows, calculateLineProgram(rows, 100, 10)).map(entry => entry.key))
    const tasks = (values: WeldRow[], keys = accepted) => buildVisibleDispatcherTasks({ rows: values, acceptedDispatcherWarningKeys: keys,
      dismissedRepeatedJointTaskKeys: new Set(), dispatcherSettings: DEFAULT_DISPATCHER_SETTINGS,
      dispatcherReminderSettings: DEFAULT_DISPATCHER_REMINDER_SETTINGS, welderStamps: [], welderStampSuspensions: [],
    }).repeatedJointTasks.filter(task => getDispatcherTaskCode(task) === 'ДЗ-27')
    expect(tasks(rows, new Set())).toHaveLength(1)
    expect(tasks(rows)).toEqual([])
    expect(indexed(tasks(rows), rows).virtual.size).toBe(0)
    // Approval of F1 does not exempt a new joint with the same combination.
    const added = [...rows, { ...rows[0], id: 2, joint: 'F2' }]
    expect(tasks(added)).toHaveLength(1)
    expect(tasks([{ ...rows[0], weldControlPercent: 50 }])).toEqual([])
    expect(tasks([{ ...rows[0], hasPvk: 'да' }])).toEqual([])
    expect(tasks([{ ...rows[0], lineProgramId: 8 }])).toEqual([])
    expect(tasks([{ ...rows[0], lineProgramId: null }])).toEqual([]) // Approval belongs to the weld ID, not a registry join.
  })
  it('keeps incomplete requirements visible as mandatory SP-02, including a single stored weld', () => {
    const rows = [row(1, { pvkControlPercent: null })]
    const tasks = buildLineConsistencyTasks(rows)
    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('СП-02')
    expect(isDispatcherTaskEnabled(tasks[0], Object.fromEntries(Object.keys(DEFAULT_DISPATCHER_SETTINGS).map((key) => [key, false])) as typeof DEFAULT_DISPATCHER_SETTINGS)).toBe(true)
    const result = indexed(tasks, rows)
    expect(result.storedIndex).toContainEqual({ rowId: 1, taskKey: 'code:СП-02', code: 'СП-02' })
    expect(result.virtual.get(1)).toBe('СП-02')
    expect(buildLineConsistencyTasks([row(1, { weldControlPercent: 0, pvkControlPercent: 0 })])).toEqual([])
  })
  it('indexes DZ-27 for two mandatory alternatives, never for mandatory plus additional', () => {
    const rows = [row(1, { weldControlPercent: 100, hasRk: 'да', hasUzk: 'да' })]
    const tasks = buildLineConsistencyTasks(rows)
    expect(tasks.map(getDispatcherTaskCode)).toEqual(['ДЗ-27'])
    expect(indexed(tasks, rows).virtual.get(1)).toBe('ДЗ-27')
    expect(buildLineConsistencyTasks([{ ...rows[0], hasUzk: 'дополнительный' }])).toEqual([])
  })
  it('agrees with planned full-line control before welding in the saved index and virtual field', () => {
    const rows = [row(1, { weldControlPercent: 100, weldDate: null, stamp1K: null, hasRk: 'да', hasUzk: 'да' })]
    expect(calculateLineProgram(rows, 100, 10)[0].common.excessAssignments).toHaveLength(1)
    const tasks = buildLineConsistencyTasks(rows)
    expect(tasks.map(getDispatcherTaskCode)).toEqual(['ДЗ-27'])
    expect(indexed(tasks, rows).virtual.get(1)).toBe('ДЗ-27')
    expect(buildLineConsistencyTasks([{ ...rows[0], weldControlPercent: 30 }])).toEqual([])
    expect(buildLineConsistencyTasks([{ ...rows[0], hasUzk: 'дополнительный' }])).toEqual([])
  })
  it('keeps conflicting metadata mandatory and does not calculate a seemingly confirmed demand', () => {
    const rows = [row(1), row(2, { category: 'I' })]
    const tasks = buildLineConsistencyTasks(rows)
    expect(tasks.map(getDispatcherTaskCode)).toEqual(['СП-02'])
    expect(indexed(tasks, rows).virtual.get(2)).toBe('СП-02')
    expect(buildPercentageLineControlTasks(rows)).toEqual([])
    expect(buildPercentageLineControlTasks([row(1, { category: null })])).toEqual([])
  })
  it('preserves independent common and PVK tasks and their demand kind in the saved payload', () => {
    const rows = Array.from({ length: 20 }, (_, index) => row(index + 1))
    const tasks = buildPercentageLineControlTasks(rows).filter((task) => task.issue === 'missing')
    expect(tasks.map((task) => [task.demandKind ?? 'common', task.count])).toEqual([['common', 6], ['pvk', 2]])
    expect(new Set(tasks.map((task) => task.key)).size).toBe(2)
    const result = indexed(tasks, rows)
    expect(result.savedTasks).toEqual(tasks)
    expect(result.virtual.size).toBe(20)
    expect(result.virtual.get(20)).toContain(getDispatcherTaskCode(tasks[0]))
  })
  it('never persists failed repairs as full-control or suspension triggers', () => {
    const rows = Array.from({ length: 10 }, (_, index) => row(index + 1, { joint: index ? `F1R${index}` : 'F1', stamp1K: index ? 'B' : 'A', vikResult: index < 5 ? 'ремонт' : null }))
    const tasks = buildPercentageLineControlTasks(rows)
    expect(tasks.filter((task) => task.issue === 'suspend-welder')).toEqual([])
    const persisted = indexed(tasks, rows).savedTasks
    expect(persisted.some(task => task.kind === 'percentage-line-control' && task.stamp === 'B')).toBe(false)
  })
})
