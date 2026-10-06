import { describe, expect, it } from 'vitest'
import { calculateLineProgram } from './line-program-calculation'
import { applyProgramPatch, getProgramBatchTargets, matchesProgramScope, previewProgramChanges, programExcessEntries, toggleProgramMethodSelection, type ProgramMethod } from './line-program-workspace'
import { summarizeLineProgram } from './line-program-overview'
import { buildPercentageLineControlTasks } from './percentage-line-tasks'
import type { WeldRow } from './dispatcher-types'

const line = { id: 1, line: 'L', projectTitle: 'P', subtitleCode: 'S', category: 'II', groupName: 'A', weldControlPercent: 100, pvkControlPercent: 10, configurationIssue: null, version: '1' }
const row = (id: number, extra: Partial<WeldRow> = {}): WeldRow => ({ joint: `F${id}`, connectionType: 'С19', weldDate: '2026-09-01', stamp1K: 'A', hasVik: 'да', ...line, ...extra, id })

describe('unified assignments, latest approved requirements', () => {
  it('allows explicitly clearing the sole ordinary assignment and shows the renewed need', () => {
    const requirements = { ...line, weldControlPercent: 10, pvkControlPercent: 0 }
    const rows = Array.from({ length: 10 }, (_, index) => row(index + 1, { hasRk: index === 0 ? 'да' : null }))
    expect(summarizeLineProgram(rows, requirements).common?.missing).toBe(0)
    const preview = previewProgramChanges(rows, [{ id: 1, values: { РК: '' } }], requirements)
    expect(preview.errors).toEqual([])
    const final = rows.map(item => preview.records.find(changed => changed.id === item.id) ?? item)
    expect(summarizeLineProgram(final, requirements).common?.missing).toBe(1)
  })
  it('couples only the layered/PVK toolbar selection without changing other methods', () => {
    const initial = new Set<ProgramMethod>(['РК'])
    const paired = toggleProgramMethodSelection(initial, 'Послойный ПВК')
    expect([...paired]).toEqual(['РК', 'Послойный ПВК', 'ПВК'])
    expect([...initial]).toEqual(['РК'])
    expect([...toggleProgramMethodSelection(paired, 'Послойный ПВК')]).toEqual(['РК'])
    expect([...toggleProgramMethodSelection(paired, 'ПВК')]).toEqual(['РК'])
    expect([...toggleProgramMethodSelection(initial, 'ПВК')]).toEqual(['РК', 'ПВК'])
  })
  it('plans a full line before welding/stamps, while PVK below 100 only counts welded own stamps', () => {
    const rows = [row(1, { stamp1Z: 'B' }), row(2, { stamp1K: 'B' }), row(3, { weldDate: null, stamp1K: null }), row(4, { stamp1K: null }), row(5, { weldDate: null, stamp1K: 'C' }), row(6, { connectionType: 'Т' }), row(7, { officiality: 'неофициальный' }), row(8, { revisionActuality: 'не актуален' })]
    const groups = calculateLineProgram(rows, 100, 10)
    expect(groups.map(group => [group.scope ?? 'stamp', group.stamp, group.common.required, group.pvk.required])).toEqual([['line', '', 5, 0], ['stamp', 'A', 0, 1], ['stamp', 'B', 0, 1]])
    const next = applyProgramPatch(rows[2], { РК: 'да', ПВК: 'да' })
    expect(next).toMatchObject({ weldDate: null, stamp1K: null, hasRk: 'да', hasPvk: 'да' })
    const updated = calculateLineProgram([rows[0], rows[1], next], 100, 10)
    expect(updated[0].common.coveredRowIds).toEqual([3])
    expect(updated.slice(1).flatMap(group => group.pvk.coveredRowIds)).toEqual([])
  })
  it('skips C joints for the whole layered batch, but never weakens individual validation', () => {
    const rows = [row(1, { hasPvk: 'дополнительный' }), row(2, { connectionType: 'У19', weldDate: null, stamp1K: null })]
    const patch = { 'Послойный ПВК': 'да', ПВК: 'да' } as const
    const targets = getProgramBatchTargets(rows, patch)
    expect(targets.map(row => row.id)).toEqual([2])
    expect(getProgramBatchTargets([rows[0]], patch)).toEqual([])
    expect(getProgramBatchTargets(rows, { ПВК: 'да' })).toEqual(rows)
    const result = previewProgramChanges(rows, targets.map(row => ({ id: row.id, values: patch })), { ...line, weldControlPercent: 30 })
    expect(result.errors).toEqual([])
    expect(result.records[0]).toMatchObject({ id: 2, layeredControlAssigned: true, hasPvk: 'да', weldDate: null })
    expect(rows[0].hasPvk).toBe('дополнительный')
    expect(previewProgramChanges(rows, [{ id: 1, values: patch }], line).errors[0]).toMatch(/У-стыков/)
    expect(calculateLineProgram(result.records, 30, 10)).toEqual([])
    expect(matchesProgramScope(rows[1], { unassigned: true })).toBe(true)
    expect(matchesProgramScope({ ...rows[1], stamp1K: 'B' }, { stamp: 'b' })).toBe(true)
    expect(matchesProgramScope({ ...rows[1], officiality: 'неофициальный' }, { unassigned: true })).toBe(false)
  })
  it('uses each physical joint once for 100% PVK too, even with several or no stamps', () => {
    const groups = calculateLineProgram([row(1, { stamp1Z: 'B' }), row(2, { weldDate: null, stamp1K: null })], 100, 100)
    expect(groups).toHaveLength(1)
    expect(groups[0].common.required).toBe(2)
    expect(groups[0].pvk.required).toBe(2)
  })
  it('allows planning before welding or stamp assignment and preserves all factual history', () => {
    const original = row(1, { hasRk: 'да', rkResult: 'годен', rkConclusion: 'RK-01', rkRequest: 'REQ-01', hasUzk: 'дополнительный', preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ПВК', result: 'годен' }] })
    const next = applyProgramPatch(original, { РК: 'отменен', УЗК: 'да', ПВК: 'дополнительный' })
    expect(next).toMatchObject({ hasRk: 'отменен', hasUzk: 'да', hasPvk: 'дополнительный', rkResult: 'годен', rkConclusion: 'RK-01', rkRequest: 'REQ-01', preHeatTreatmentControls: original.preHeatTreatmentControls })
    expect(original.hasRk).toBe('да')
    expect(applyProgramPatch(row(2, { weldDate: null }), { РК: 'да' })).toMatchObject({ hasRk: 'да', weldDate: null })
    expect(applyProgramPatch(row(2, { stamp1K: null }), { РК: 'да' })).toMatchObject({ hasRk: 'да', stamp1K: null })
  })
  it('allows user-picked excess and duplicate methods in preview instead of rejecting any selection above missing', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(i + 1))
    const preview = previewProgramChanges(rows, [{ id: 1, values: { РК: 'да', ПВК: 'да' } }, { id: 2, values: { РК: 'да', УЗК: 'да', ПВК: 'да' } }], { ...line, weldControlPercent: 10 })
    expect(preview.errors).toEqual([])
    expect(preview.records.map(row => row.id)).toEqual([1, 2])
    expect(preview.newExcess).toHaveLength(3)
    expect(preview.newExcess.every(entry => entry.rowId === 2)).toBe(true)
  })
  it('counts additional joints once across methods; approved interchangeable methods leave the excess counter only for that exact quota/assignment', () => {
    const rows = [row(1, { hasRk: 'да', hasUzk: 'да' }), row(2, { hasRk: 'дополнительный', hasPvk: 'дополнительный' })]
    const entries = programExcessEntries(line.id, rows, calculateLineProgram(rows, 100, 10))
    const accepted = new Set(entries.map(entry => entry.key))
    expect(summarizeLineProgram(rows, line, accepted)).toMatchObject({ additional: 1, approved: 1, common: { excess: 0 } })
    expect(summarizeLineProgram([{ ...rows[0], hasRk: 'отменен' }, rows[1]], line, accepted).approved).toBe(0)
  })
  it('layered assignment stays U-only, exposes implied PVK in draft, and never cancels other methods silently', () => {
    expect(() => applyProgramPatch(row(1), { 'Послойный ПВК': 'да' })).toThrow(/У-стыков/)
    const next = applyProgramPatch(row(1, { connectionType: 'У19', hasRk: 'да', hasPvk: 'отменен' }), { 'Послойный ПВК': 'да', ПВК: 'да' })
    expect(next).toMatchObject({ hasVik: 'да', hasPvk: 'да', hasRk: 'да', layeredControlAssigned: true })
    expect(() => applyProgramPatch(next, { ПВК: 'отменен' })).toThrow(/ПВК/)
    expect(() => applyProgramPatch(next, { 'Послойный ПВК': 'отменен' })).toThrow(/отдельной/)
    expect(() => applyProgramPatch(row(1, { connectionType: 'У', preHeatTreatmentLnkEnabled: false, preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'РК', result: 'ремонт' }] }), { 'Послойный ПВК': 'да' })).toThrow(/ремонт/)
  })
  it.each(['отменен', 'дополнительный'])('does not silently replace %s PVK with layered control', hasPvk => {
    const original = row(1, { connectionType: 'У19', hasPvk })
    expect(() => applyProgramPatch(original, { 'Послойный ПВК': 'да' })).toThrow(/Подтвердите перевод ПВК/)
    expect(previewProgramChanges([original], [{ id: 1, values: { 'Послойный ПВК': 'да' } }], line).errors).toHaveLength(1)
    expect(original.hasPvk).toBe(hasPvk)
    expect(applyProgramPatch(original, { 'Послойный ПВК': 'да', ПВК: 'да' })).toMatchObject({ hasPvk: 'да', layeredControlAssigned: true })
  })
  it('does not turn calculated no-demand after rejection into an extra manual-edit ban', () => {
    const original = row(1, { rkResult: 'ремонт', hasRk: 'да', rkConclusion: 'RK-1' })
    const next = applyProgramPatch(original, { УЗК: 'да' })
    expect(next).toMatchObject({ hasUzk: 'да', rkResult: 'ремонт', rkConclusion: 'RK-1' })
    // The factual RK still covers this joint; a pending UZK does not add another place.
    expect(calculateLineProgram([next], 100, 10)[0].common.coveredRowIds).toEqual([1])
    expect(calculateLineProgram([{ ...next, rkResult: null, vikResult: 'ремонт' }], 100, 10)[0].common.coveredRowIds).toEqual([])
  })
  it('dispatcher includes unstamped unwelded full-line planning without multiplying common quota by stamps', () => {
    const tasks = buildPercentageLineControlTasks([row(1, { weldDate: null, stamp1K: null }), row(2, { stamp1Z: 'B' })])
    expect(tasks.find(task => task.issue === 'missing' && task.demandKind !== 'pvk')).toMatchObject({ requiredControls: 2, targetRowIds: [1, 2] })
    expect(tasks.filter(task => task.issue === 'missing' && task.demandKind === 'pvk').map(task => task.stamp).sort()).toEqual(['A', 'B'])
  })
})
