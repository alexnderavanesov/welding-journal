import { expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { calculateLineProgram } from './line-program-calculation'
import { compactLineProgramDemand, summarizeLineProgram } from './line-program-overview'
import { buildLineProgramDisplay } from './line-program-display'
import { buildPercentageLineControlTasks } from './percentage-line-tasks'
import { parseDispatcherTaskIndexPayload, serializeDispatcherTaskIndexPayload } from './dispatcher-task-index-payload'
import { buildDispatcherTaskCodeIndexRows, buildMergedDispatcherTaskCodes } from './dispatcher-task-row-codes'

const line = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', category: 'II', groupName: 'A', weldControlPercent: 30, pvkControlPercent: 10, version: '1', configurationIssue: null }
function fixture(value: string, connectionType = 'С17'): WeldRow[] {
  return Array.from({ length: 20 }, (_, i) => ({ ...line, id: i + 1, joint: 'F' + (i + 1), connectionType, hasVik: 'да', vikResult: 'годен',
    officiality: 'действующий', revisionActuality: 'актуальная', weldDate: '2026-09-01', stamp1K: 'A', pstoRequired: 'да',
    hasRk: i < 6 ? value : null, hasPvk: i < 2 ? value : null,
    rkResult: i < 6 ? 'ожидает заявку' : null, pvkResult: i < 2 ? 'ожидает заявку' : null,
  }))
}
const rejectionSources: Partial<WeldRow>[] = [
  { vikResult: 'ремонт', vikConclusion: 'VIK-REJECT' },
  { preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ВИК', result: 'вырез', conclusionName: 'PRE-REJECT' }] },
  { duplicateControls: [{ id: 1, weldJointId: 1, method: 'ВИК', result: 'ремонт', conclusion: 'DUP-REJECT', conclusionDate: '2026-09-01', controlDate: '2026-09-01' }] },
]
for (const value of ['да', 'дополнительный']) for (const family of ['С17', 'У19']) it.each(rejectionSources)(`${value}, ${family}: unperformed assignments stop covering the norm after own rejection %j`, rejection => {
  const rows = fixture(value, family), before = structuredClone(rows)
  rows[0] = { ...rows[0], ...rejection }
  const saved = structuredClone(rows)
  const groups = calculateLineProgram(rows, 30, 10), display = buildLineProgramDisplay(rows, groups, 30, 10), overview = summarizeLineProgram(rows, line)
  // VIK rejection removes pending credit, but never adds RK/UZK surcharge.
  for (const [kind, required, covered, missing] of [['common', 6, 5, 1], ['pvk', 2, 1, 1]] as const) {
    const demand = groups[0][kind]
    expect(demand.required).toBe(required)
    expect(demand.coveredRowIds).not.toContain(1)
    expect(demand.candidateRowIds).not.toContain(1)
    expect(demand.completedRowIds).toEqual([])
    expect(compactLineProgramDemand(demand)).toMatchObject({ required, covered, missing })
    expect(display.summary[kind]).toMatchObject({ required, covered, missing })
    expect(overview[kind]).toMatchObject({ required, covered, missing })
  }
  const tasks = buildPercentageLineControlTasks(rows).filter(task => task.issue === 'missing')
  expect(tasks).toHaveLength(2)
  const savedTasks = parseDispatcherTaskIndexPayload(serializeDispatcherTaskIndexPayload(tasks)).tasks
  const index = buildDispatcherTaskCodeIndexRows(savedTasks, rows)
  expect(index.length).toBeGreaterThan(0)
  expect(buildMergedDispatcherTaskCodes(index, []).allByRowId.size).toBeGreaterThan(0)
  expect(rows).toEqual(saved) // No automatic clearing of assignment or documents.
  rows[0] = before[0]
  for (const kind of ['common', 'pvk'] as const) expect(calculateLineProgram(rows, 30, 10)[0][kind].missing).toBe(0)
})

it.each(['да', 'дополнительный'])('RK repair is a performed fact; pending UZK and PVK with %s are not new credit', value => {
  const rows = fixture(value)
  rows[0] = { ...rows[0], rkResult: 'ремонт', rkConclusion: 'RK-REJECT', hasUzk: value, uzkResult: 'ожидает заявку' }
  const [group] = calculateLineProgram(rows, 30, 10)
  expect(group.common).toMatchObject({ required: 8, coveredRowIds: [1, 2, 3, 4, 5, 6], completedRowIds: [1], missing: 2 })
  expect(group.pvk).toMatchObject({ required: 2, coveredRowIds: [2], completedRowIds: [], missing: 1 })
  // Own PVK facts stay in history, but rejection removes PVK credit.
  rows[0].preHeatTreatmentControls = [{ id: 1, weldJointId: 1, method: 'ПВК', result: 'годен', conclusionName: 'PRE-PVK' }]
  expect(calculateLineProgram(rows, 30, 10)[0].pvk).toMatchObject({ coveredRowIds: [2], completedRowIds: [1], missing: 1 })
  rows[0].preHeatTreatmentLnkEnabled = false
  expect(calculateLineProgram(rows, 30, 10)[0].pvk).toMatchObject({ coveredRowIds: [2], missing: 1 })
})
