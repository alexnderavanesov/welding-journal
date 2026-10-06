import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { calculateLineProgram } from './line-program-calculation'
import { applyProgramPatch, programExcessEntries, type ProgramPatch } from './line-program-workspace'
import { countProgramRemovalHints, getProgramRemovalHints, partitionProgramExcess, projectProgramExcess } from './line-program-excess'
import { summarizeLineProgram } from './line-program-overview'
import { buildLineProgramDisplay } from './line-program-display'
import { createProgramRowSelector } from './line-program-selection'

const row = (id: number, patch: Partial<WeldRow> = {}): WeldRow => ({ id, joint: 'F' + id, connectionType: 'С17', weldDate: '2026-09-01', stamp1K: 'A', ...patch })
const line = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', category: 'II', groupName: 'A', weldControlPercent: 30, pvkControlPercent: 10, version: '1', configurationIssue: null }
describe('excess accounting and safe manual removal suggestions', () => {
  it('counts two interchangeable assignments on an angular joint, not one problematic joint', () => {
    const rows = [row(1, { connectionType: 'У19', hasRk: 'да', hasUzk: 'да', hasPvk: 'да', layeredControlAssigned: true })]
    const result = summarizeLineProgram(rows, { ...line, weldControlPercent: 100, pvkControlPercent: 100 })
    expect(result.common?.excess).toBe(2)
    expect(result.reducible).toBe(2)
    const display = buildLineProgramDisplay(rows, calculateLineProgram(rows, 100, 100), 100, 100)
    expect(display.summary.common.excess + display.summary.common.duplicateAssignments).toBe(2)
  })
  it('counts an ordinary yes displaced by a completed cancelled method, without proposing to erase its fact', () => {
    const rows = [row(1, { hasRk: 'отменен', rkResult: 'годен', rkConclusion: 'РК-1', hasUzk: 'да' })]
    const result = summarizeLineProgram(rows, { ...line, weldControlPercent: 100, pvkControlPercent: 100 })
    expect(result.common?.excess).toBe(1)
    expect(result.reducible).toBe(1)
    expect([...getProgramRemovalHints(1, rows, calculateLineProgram(rows, 100, 100), new Set()).get(1)!.keys()]).toEqual(['УЗК'])
  })
  it('finds a jointly removable subset on 200,000 assigned joints with protected history', () => {
    const rows = Array.from({ length: 200_000 }, (_, index) => row(index + 1, {
      hasRk: 'да', rkRequest: index % 3 === 0 ? 'Заявка' : null,
    }))
    const groups = calculateLineProgram(rows, 50, 0)
    const hints = getProgramRemovalHints(1, rows, groups, new Set())
    expect(countProgramRemovalHints(hints)).toBe(100_000)
    expect([...hints.keys()].every(id => (id - 1) % 3 !== 0)).toBe(true)
    const next = rows.map(row => hints.has(row.id) ? applyProgramPatch(row, { РК: '' }) : row)
    const after = calculateLineProgram(next, 50, 0)[0].common
    expect(after.missing).toBe(0)
    expect(after.excessRowIds).toEqual([])
  }, 60_000)
  it('finds a removable alternative when the quota surplus was attributed to a completed joint', () => {
    const rows = [row(1, { hasRk: 'да' }), row(2, { hasRk: 'да', rkResult: 'годен', rkConclusion: 'РК-2' })]
    const groups = calculateLineProgram(rows, 50, 0)
    // The shared accounting now prefers the same removable assignment in both views.
    expect(groups[0].common.excessRowIds).toEqual([1])
    const hints = getProgramRemovalHints(1, rows, groups, new Set())
    expect([...hints.keys()]).toEqual([1])
    expect([...hints.get(1)!.keys()]).toEqual(['РК'])
    const after = calculateLineProgram([applyProgramPatch(rows[0], { РК: '' }), rows[1]], 50, 0)
    expect(after[0].common.missing).toBe(0)
    expect(after[0].common.excessRowIds).toEqual([])
  })
  it('protects a request on any stage, but not a waiting label without a request', () => {
    const rows = [row(1, { hasRk: 'да', rkResult: 'ожидает заявку' }),
      row(2, { hasRk: 'да', rkRequest: 'РК-2', rkResult: 'ожидает НК' }),
      row(3, { hasRk: 'да', preHeatTreatmentLnkEnabled: false, preHeatTreatmentControls: [{ id: 1, weldJointId: 3, method: 'РК', requestName: 'ДО-3' }] }),
      row(4, { hasRk: 'да', rkConclusion: 'РК-4', rkResult: 'годен' })]
    const hints = getProgramRemovalHints(1, rows, calculateLineProgram(rows, 50, 0), new Set())
    expect([...hints.keys()]).toEqual([1])
  })
  it('suggests only a jointly safe subset across shared welders, never all interchangeable alternatives', () => {
    const rows = [row(1, { stamp1Z: 'B', hasRk: 'да' }), row(2, { stamp1Z: 'B', hasRk: 'да' }),
      row(3, { hasRk: 'да', rkResult: 'годен', rkConclusion: 'РК-3' })]
    const before = calculateLineProgram(rows, 50, 0)
    const hints = getProgramRemovalHints(1, rows, before, new Set())
    expect([...hints.keys()]).toEqual([2])
    const after = calculateLineProgram(rows.map(r => hints.has(r.id) ? applyProgramPatch(r, { РК: '' }) : r), 50, 0)
    expect(after.every(group => group.common.missing === 0)).toBe(true)
  })
  it('confirming additional coverage does not hide the displaced ordinary yes candidate', () => {
    const rows = [row(1, { hasRk: 'да' }), row(2, { hasRk: 'да' }), row(3, { hasRk: 'дополнительный' }), row(4)]
    const groups = calculateLineProgram(rows, 50, 0), entries = programExcessEntries(1, rows, groups)
    expect(entries).toHaveLength(1)
    const accepted = new Set(entries.map(entry => entry.key))
    expect(getProgramRemovalHints(1, rows, groups, accepted).get(2)?.get('РК')).toContain('сверх нормы')
    expect(getProgramRemovalHints(1, rows, groups, accepted).has(3)).toBe(false)
    expect(summarizeLineProgram(rows, { ...line, weldControlPercent: 50, pvkControlPercent: 0 }, accepted).common?.excess).toBe(1)
  })
  it('keeps additional controls separate and removes approved interchangeable yes methods from every view', () => {
    const rows = [row(1, { hasRk: 'да', hasUzk: 'да' }), row(2, { hasRk: 'дополнительный', hasPvk: 'дополнительный', rkResult: 'годен' })]
    const groups = calculateLineProgram(rows, 100, 10), entries = programExcessEntries(1, rows, groups)
    const approved = new Set(entries.map(entry => entry.key))
    expect(entries).toHaveLength(1)
    expect(getProgramRemovalHints(1, rows, groups, new Set()).get(1)?.has('УЗК')).toBe(true)
    expect(getProgramRemovalHints(1, rows, groups, new Set()).get(1)?.has('РК')).toBe(false)
    expect(getProgramRemovalHints(1, rows, groups, approved).size).toBe(0)
    expect(summarizeLineProgram(rows, { ...line, weldControlPercent: 100 }, approved)).toMatchObject({ additional: 1, approved: 1, common: { excess: 0 } })
    expect(buildLineProgramDisplay(rows, projectProgramExcess(1, rows, groups, approved), 100, 10).summary.common.duplicateAssignments).toBe(0)
    const select = createProgramRowSelector(rows, groups, 1, approved)
    expect(select({ slice: 'excess' })).toEqual([])
    expect(select({ slice: 'approved' }).map(row => row.id)).toEqual([1])
    expect(partitionProgramExcess(programExcessEntries(1, rows, calculateLineProgram(rows, 30, 10)), approved).pending.length).toBeGreaterThan(0)
  })
  it('counts a physical excess once across stamps and preserves both quotas when suggested removals are combined', () => {
    const rows = [row(1, { stamp1Z: 'B', hasRk: 'да' }), row(2, { stamp1Z: 'B', hasRk: 'да', hasUzk: 'да' }), row(3, { hasRk: 'дополнительный' })]
    const groups = calculateLineProgram(rows, 30, 10), hints = getProgramRemovalHints(1, rows, groups, new Set())
    expect(summarizeLineProgram(rows, line).common?.excess).toBe(2) // one extra joint + one interchangeable assignment, not twice per stamp
    expect(hints.get(2)?.size).toBe(2)
    expect(hints.has(1)).toBe(false)
    expect(hints.has(3)).toBe(false)
    const after = rows.map(row => applyProgramPatch(row, Object.fromEntries([...(hints.get(row.id)?.keys() ?? [])].map(method => [method, ''])) as ProgramPatch))
    expect(calculateLineProgram(after, 30, 10).every(group => group.common.coveredRowIds.length >= group.common.required)).toBe(true)
    const display = buildLineProgramDisplay(rows, groups, 30, 10)
    expect(display.summary.common.excess + display.summary.common.duplicateAssignments).toBe(2)
  })
  it('never suggests removing facts, protected preheat work, approved patterns or necessary layered PVK', () => {
    const rows = [row(1, { hasRk: 'да', hasUzk: 'да', rkResult: 'годен', uzkConclusion: 'UZ-1' }),
      row(2, { hasRk: 'да', rkResult: 'ожидает НК', preHeatTreatmentLnkEnabled: false, preHeatTreatmentControls: [{ id: 1, weldJointId: 2, method: 'РК', requestName: 'PRE' }] }),
      row(3, { connectionType: 'У19', layeredControlAssigned: true, hasPvk: 'да' })]
    const groups = calculateLineProgram(rows, 30, 10)
    expect(getProgramRemovalHints(1, rows, groups, new Set()).size).toBe(0)
  })
  it('keeps only actionable demand consistently across summaries and selected candidates', () => {
    const rows = [row(1, { hasRk: 'да', stamp1Z: 'B' }), row(2, { hasRk: 'да', hasPvk: 'да' }), row(3, { hasUzk: 'да', hasPvk: 'да' }), row(4, { vikResult: 'ремонт' }), row(5, { hasRk: 'да', hasPvk: 'да' })]
    const groups = calculateLineProgram(rows, 100, 30), display = buildLineProgramDisplay(rows, groups, 100, 30)
    const overview = summarizeLineProgram(rows, { ...line, weldControlPercent: 100, pvkControlPercent: 30 })
    expect(display.summary.common).toMatchObject({ required: 5, actionableRequired: 4, missing: 0 })
    expect(display.summary.pvk.missing).toBe(1)
    expect(display.summary.common.missing + display.summary.pvk.missing).toBe(overview.common!.missing + overview.pvk!.missing)
    const select = createProgramRowSelector(rows, groups, 1, new Set())
    expect(select({ slice: 'missing', kind: 'common' }).map(row => row.id)).toEqual([])
    expect(select({ slice: 'missing', kind: 'pvk', stamp: 'B' }).map(row => row.id)).toEqual([1])
  })
  it.each([30, 100])('indexes 200,000 rows once for many expanded stamp blocks on a %s%% line', percent => {
    const rows = Array.from({ length: 200_000 }, (_, index) => row(index + 1, { stamp1K: 'K' + index % 2000 }))
    const select = createProgramRowSelector(rows, calculateLineProgram(rows, percent, 10), 1, new Set())
    expect(select({ slice: 'all' })).toBe(rows)
    for (let stamp = 0; stamp < 2000; stamp++) {
      expect(select({ slice: 'all', stamp: 'K' + stamp })).toHaveLength(100)
      expect(select({ slice: 'missing', stamp: 'K' + stamp })).toHaveLength(100)
    }
  }, 30_000)
})
