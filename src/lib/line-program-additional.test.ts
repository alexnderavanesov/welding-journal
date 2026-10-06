import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { calculateLineProgram } from './line-program-calculation'
import { buildLineProgramDisplay } from './line-program-display'
import { compactLineProgramDemand, summarizeLineProgram } from './line-program-overview'
import { createProgramRowSelector } from './line-program-selection'
import { buildPercentageLineControlTasks } from './percentage-line-tasks'
import { buildLineConsistencyTasks } from './line-consistency-tasks'
import { buildDispatcherTaskCodeIndexRows, buildMergedDispatcherTaskCodes } from './dispatcher-task-row-codes'
import { parseDispatcherTaskIndexPayload, serializeDispatcherTaskIndexPayload } from './dispatcher-task-index-payload'
import { applyProgramPatch, previewProgramChanges } from './line-program-workspace'
import { getProgramRemovalHints } from './line-program-excess'
import { getProgramDemandAccounting } from './line-program-accounting'

const line = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', category: 'II', groupName: 'A', weldControlPercent: 50, pvkControlPercent: 50, version: '1', configurationIssue: null }
const row = (id: number, patch: Partial<WeldRow> = {}): WeldRow => ({ ...line, id, joint: 'F' + id, connectionType: 'С17', weldDate: '2026-09-01', stamp1K: 'A', ...patch })

describe('additional control counts toward demand once per joint (28 September clarification)', () => {
  it.each([1, 2, 3])('at quota two, two yes plus an additional joint %s produce one removable yes, never an additional candidate', additionalId => {
    const rows = [1, 2, 3, 4].map(id => row(id, { hasRk: id === additionalId ? 'дополнительный' : id < 4 ? 'да' : null, hasPvk: id === additionalId ? 'дополнительный' : id < 4 ? 'да' : null }))
    const groups = calculateLineProgram(rows, 50, 50)
    const hints = getProgramRemovalHints(1, rows, groups, new Set())
    for (const kind of ['common', 'pvk'] as const) {
      const demand = groups[0][kind]
      expect(demand.required).toBe(2)
      expect(demand.coveredRowIds).toHaveLength(3)
      expect(demand.missing).toBe(0)
      expect(demand.excessRowIds).toHaveLength(1)
      expect(demand.excessRowIds).not.toContain(additionalId)
      expect(getProgramDemandAccounting(demand)).toMatchObject({ assignments: { yesOnly: 2, additionalOnly: 1, mixed: 0, total: 3 }, coverage: { yesOnly: 2, additionalOnly: 1, mixed: 0, total: 3, other: 0 } })
    }
    expect(hints.has(additionalId)).toBe(false)
    const after = rows.map(row => applyProgramPatch(row, Object.fromEntries([...(hints.get(row.id)?.keys() ?? [])].map(method => [method, '']))))
    for (const kind of ['common', 'pvk'] as const) expect(calculateLineProgram(after, 50, 50)[0][kind]).toMatchObject({ required: 2, missing: 0, excessRowIds: [] })
  })

  it('does not suggest removing yes from a mixed joint just to leave the same additional coverage', () => {
    const rows = [row(1, { hasRk: 'да' }), row(2, { hasRk: 'да' }), row(3, { hasRk: 'да', hasUzk: 'дополнительный' }), row(4)]
    const groups = calculateLineProgram(rows, 50, 50)
    expect(groups[0].common.excessRowIds).toEqual([2])
    expect(groups[0].common.duplicateAssignmentRowIds).toEqual([])
    expect(getProgramRemovalHints(1, rows, groups, new Set()).has(3)).toBe(false)
    expect(getProgramDemandAccounting(groups[0].common).assignments).toMatchObject({ yesOnly: 2, additionalOnly: 0, mixed: 1, total: 3 })
  })

  it('never creates excess for additional-only control, including zero quota and protected multi-stamp coverage', () => {
    for (const percent of [0, 10, 100]) {
      const rows = [1, 2, 3].map(id => row(id, { hasRk: 'дополнительный', hasUzk: 'дополнительный', hasPvk: 'дополнительный' }))
      expect(calculateLineProgram(rows, percent, percent).every(group => !group.common.excessRowIds.length && !group.common.duplicateAssignmentRowIds.length && !group.pvk.excessRowIds.length)).toBe(true)
    }
    const rows = [row(1, { stamp1Z: 'B', hasRk: 'да' }), row(2, { stamp1Z: 'C', hasRk: 'да' }), row(3, { hasRk: 'дополнительный' })]
    expect(calculateLineProgram(rows, 10, 0).every(group => !group.common.excessRowIds.length)).toBe(true)
  })

  it('the shared server preview exposes a displaced yes and preserves all factual history', () => {
    const rows = [row(1, { hasRk: 'да' }), row(2, { hasRk: 'да' }), row(3, { vikResult: 'годен', vikConclusion: 'VIK-3' }), row(4)]
    const preview = previewProgramChanges(rows, [{ id: 3, values: { РК: 'дополнительный' } }], line)
    expect(preview.errors).toEqual([])
    expect(preview.newExcess).toHaveLength(1)
    expect(preview.newExcess[0]).toMatchObject({ rowId: 2, kind: 'common', duplicate: false })
    expect(preview.records[0]).toMatchObject({ hasRk: 'дополнительный', vikResult: 'годен', vikConclusion: 'VIK-3' })
  })

  it.each(['РК', 'УЗК'] as const)('counts additional %s and PVK without duplicating yes + additional on the same joint', method => {
    const rows = [row(1, { hasRk: 'да', hasPvk: 'да' }),
      row(2, { [method === 'РК' ? 'hasRk' : 'hasUzk']: 'дополнительный', hasPvk: 'дополнительный' }),
      row(3, { hasRk: 'да', hasUzk: 'дополнительный', hasPvk: 'да' }), row(4), row(5), row(6)]
    const groups = calculateLineProgram(rows, 50, 50), display = buildLineProgramDisplay(rows, groups, 50, 50)
    const select = createProgramRowSelector(rows, groups, 1, new Set())
    for (const kind of ['common', 'pvk'] as const) {
      expect(groups[0][kind]).toMatchObject({ required: 3, coveredRowIds: [1, 2, 3], missing: 0, excessRowIds: [], duplicateAssignmentRowIds: [] })
      expect(compactLineProgramDemand(groups[0][kind])).toMatchObject({ assigned: 3, covered: 3, missing: 0 })
      expect(display.summary[kind]).toMatchObject({ assigned: 3, covered: 3, missing: 0 })
      expect(summarizeLineProgram(rows, line)[kind]).toMatchObject({ covered: 3, missing: 0, excess: 0 })
      expect(select({ kind, slice: 'assigned' }).map(row => row.id)).toEqual([1, 2, 3])
      expect(select({ kind, slice: 'missing' })).toEqual([])
    }
    expect(buildPercentageLineControlTasks(rows)).toEqual([])
    expect(buildLineConsistencyTasks(rows)).toEqual([])
  })

  it('closes rejection surcharge with additional assignments without inventing performed results', () => {
    const rows = Array.from({ length: 20 }, (_, index) => row(index + 1, {
      weldControlPercent: 30, pvkControlPercent: 10,
      hasRk: index < 6 ? 'да' : index < 8 ? 'дополнительный' : null,
      rkResult: index === 0 ? 'ремонт' : null,
    }))
    const demand = calculateLineProgram(rows, 30, 10)[0].common
    expect(demand).toMatchObject({ baseRequired: 6, additionalRequired: 2, required: 8, missing: 0, completedRowIds: [1], excessRowIds: [] })
    expect(demand.coveredRowIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('keeps additional performed facts, rejects waiting-only credit after VIK rejection and respects disabled preheat', () => {
    const rows = [row(1, { hasPvk: 'дополнительный', pvkResult: 'ремонт' }),
      row(2, { hasPvk: 'дополнительный', vikResult: 'ремонт', pvkResult: 'ожидает НК' }),
      row(3, { hasPvk: 'дополнительный', vikResult: 'ремонт', preHeatTreatmentControls: [{ id: 1, weldJointId: 3, method: 'ПВК', result: 'годен' }] }),
      row(4, { hasPvk: 'дополнительный', vikResult: 'ремонт', preHeatTreatmentLnkEnabled: false, preHeatTreatmentControls: [{ id: 2, weldJointId: 4, method: 'ПВК', result: 'годен' }] }), row(5)]
    expect(calculateLineProgram(rows, 100, 100)[0].pvk).toMatchObject({ coveredRowIds: [], completedRowIds: [1, 3], candidateRowIds: [5], missing: 1 })
    // Ordinary PVK, even additional and completed, never silently becomes a layered replacement.
    expect(calculateLineProgram([row(1, { connectionType: 'У19', hasPvk: 'дополнительный', pvkResult: 'годен' })], 100, 100)[0].common.coveredRowIds).toEqual([])
  })

  it('updates saved dispatcher payload, row index and virtual tasks when an existing joint receives additional control', () => {
    const original = [row(1), row(2, { hasRk: 'да', hasPvk: 'да' }), row(3), row(4)]
    const getCodes = (rows: WeldRow[]) => {
      const tasks = buildPercentageLineControlTasks(rows)
      const saved = parseDispatcherTaskIndexPayload(serializeDispatcherTaskIndexPayload(tasks)).tasks
      const indexed = buildDispatcherTaskCodeIndexRows(saved, rows)
      return { tasks, indexed, virtual: buildMergedDispatcherTaskCodes(indexed, []).allByRowId }
    }
    expect(getCodes(original).tasks.filter(task => task.issue === 'missing')).toHaveLength(2)
    const after = getCodes(original.map(row => row.id === 1 ? { ...row, hasRk: 'дополнительный', hasPvk: 'дополнительный' } : row))
    expect(after.tasks).toEqual([])
    expect(after.indexed).toEqual([])
    expect(after.virtual.size).toBe(0)
  })
})
