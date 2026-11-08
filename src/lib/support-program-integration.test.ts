import { describe, expect, it } from 'vitest'
import type { WeldRow, RepeatedJointTask } from './dispatcher-types'
import { calculateSupportRequired } from './support-program-calculation'
import { calculateLineProgram } from './line-program-calculation'
import { asSupportLineProgram, normalizeLineProgramSaveRequest } from './line-program'
import { buildPercentageLineSummaries } from './percentage-line-summary'
import { buildPercentageLineControlTasks } from './percentage-line-tasks'
import { buildLineConsistencyTasks } from './line-consistency-tasks'
import { buildJointCoreDataCheckTasks, buildSupportJointCheckTasks } from './repeated-joint-check-tasks'
import { getDispatcherTaskCode } from './dispatcher-settings'
import { buildDispatcherTaskCodeIndexRows, buildMergedDispatcherTaskCodes } from './dispatcher-task-row-codes'
import { serializeDispatcherTaskIndexPayload, parseDispatcherTaskIndexPayload } from './dispatcher-task-index-payload'

const row = (id: number, extra: Partial<WeldRow> = {}): WeldRow => ({ id, lineProgramId: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: `ОП${id}`, connectionType: 'Т1',
  officiality: 'действующий', revisionActuality: 'актуальная', weldDate: '2026-09-01', stamp1K: 'A', hasVik: 'да',
  weldingMethod: 'РД', materialGroup: 'M01', weldLength: '600.123456789', category: 'II', groupName: 'A', weldControlPercent: 30, pvkControlPercent: 10, ...extra })

function indexed(tasks: RepeatedJointTask[], rows: WeldRow[]) {
  const persisted = parseDispatcherTaskIndexPayload(serializeDispatcherTaskIndexPayload(tasks)).tasks
  const entries = buildDispatcherTaskCodeIndexRows(persisted, rows)
  return buildMergedDispatcherTaskCodes(entries, []).allByRowId
}

describe('support quotas integrated with live settings and dispatcher', () => {
  it('uses exact decimal ceilings without a phantom extra position', () => {
    expect(calculateSupportRequired(200, 0.5)).toBe(1)
    expect(calculateSupportRequired(201, 0.5)).toBe(2)
    expect(calculateSupportRequired(1000, 33.3)).toBe(333)
    expect(calculateSupportRequired(5, 60)).toBe(3)
    expect(calculateSupportRequired(200000, 0.501)).toBe(1002)
    expect(calculateSupportRequired(0, 100)).toBe(0)
  })
  it('inherits each live norm with a 0.5 minimum and keeps unknown distinct from zero', () => {
    const base = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', category: 'II', groupName: 'A', weldControlPercent: 0, pvkControlPercent: null, configurationIssue: null, version: 'v' }
    expect(asSupportLineProgram(base)).toMatchObject({ weldControlPercent: 0.5, pvkControlPercent: null })
    const own = normalizeLineProgramSaveRequest({ ...base, supportUzkControlPercent: 0.5, supportPvkControlPercent: 80 })
    expect(asSupportLineProgram({ ...base, ...own })).toMatchObject({ weldControlPercent: 0.5, pvkControlPercent: 80, configurationIssue: null })
    expect(asSupportLineProgram({ ...base, weldControlPercent: 50, pvkControlPercent: 25, supportUzkControlPercent: null, supportPvkControlPercent: null })).toMatchObject({ weldControlPercent: 50, pvkControlPercent: 25 })
    expect(() => normalizeLineProgramSaveRequest({ ...base, supportUzkControlPercent: 0 })).toThrow('0,5')
  })
  it('keeps C/U and T independent on the same line and uses live own support norms', () => {
    const rows = [row(1, { supportUzkControlPercent: 100, supportPvkControlPercent: 0.5 }), row(2, { supportUzkControlPercent: 100, supportPvkControlPercent: 0.5 }), row(3, { joint: 'F3', connectionType: 'С17' })]
    const summaries = buildPercentageLineSummaries(rows)
    expect(summaries).toHaveLength(2)
    expect(summaries.find(item => item.support)?.stamps[0]).toMatchObject({ officialJointCount: 2, requiredControls: 2, common: { percent: 100 }, pvk: { percent: 0.5, required: 1 } })
    expect(summaries.find(item => !item.support)?.stamps[0]).toMatchObject({ officialJointCount: 1, requiredControls: 1 })
    expect(calculateLineProgram(rows, 30, 10)[0].rowIds).toEqual([3])
    const tasks = buildPercentageLineControlTasks(rows)
    expect(tasks.filter(task => task.row.connectionType === 'Т1' && task.issue === 'missing')).toHaveLength(2)
    expect(indexed(tasks, rows).get(1)).toContain('СП-01')
  })
  it('counts the R10 chain once under its original welder, with no defect escalation', () => {
    const rows = [row(1, { hasUzk: 'да', uzkResult: 'ремонт' }), ...Array.from({ length: 10 }, (_, i) => row(i + 2, { joint: `ОП1R${i + 1}`, stamp1K: 'REPAIR', hasUzk: 'да', uzkResult: i === 9 ? 'годен' : 'ремонт' }))]
    const groups = calculateLineProgram(rows, 30, 10, undefined, undefined, true)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ stamp: 'A', rowIds: [1], rejectedRowIds: [], fullControlRequired: false, common: { required: 1, additionalRequired: 0, coveredRowIds: [1], completedRowIds: [1] } })
    expect(buildPercentageLineControlTasks(rows).some(task => ['suspend-welder', 'rejected-rows', 'new-welder'].includes(task.issue))).toBe(false)
  })
  it('caps debt by available noncancelled supports while keeping full calculated norm', () => {
    const rows = [row(1, { hasUzk: 'да' }), row(2, { hasUzk: 'да' }), row(3, { hasUzk: 'отменен' })]
    expect(calculateLineProgram(rows, 100, 100, undefined, undefined, true)[0].common).toMatchObject({ required: 3, actionableRequired: 2, coveredRowIds: [1, 2], missing: 0, cancelledRowIds: [3] })
  })
  it('does not demand ordinary percentages when both support norms are explicitly set', () => {
    const rows = [row(1, { weldControlPercent: null, pvkControlPercent: null, supportUzkControlPercent: 15, supportPvkControlPercent: 80 })]
    expect(buildLineConsistencyTasks(rows)).toEqual([])
    expect(buildPercentageLineSummaries(rows)[0]).toMatchObject({ percent: 15, support: true })
    expect(buildLineConsistencyTasks([{ ...rows[0], supportPvkControlPercent: null }]).map(getDispatcherTaskCode)).toEqual(['СП-01'])
  })
  it('publishes mandatory structural SP-13 and missing length SP-03 without changing stored facts', () => {
    const invalid = row(1, { stamp1Z: 'B', weldLength: -1 })
    const tasks = buildSupportJointCheckTasks([invalid])
    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('СП-13')
    expect(indexed(tasks, [invalid]).get(1)).toBe('СП-13')
    const missing = row(2, { weldLength: null })
    expect(buildSupportJointCheckTasks([missing])).toEqual([])
    expect(indexed(buildJointCoreDataCheckTasks([missing]), [missing]).get(2)).toBe('СП-03')
    expect(invalid).toMatchObject({ stamp1Z: 'B', weldLength: -1 })
  })
})
