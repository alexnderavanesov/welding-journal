import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { calculateLineProgram } from './line-program-calculation'
import { compactLineProgramDemand, summarizeLineProgram } from './line-program-overview'
import { buildLineProgramDisplay } from './line-program-display'
import { createProgramRowSelector } from './line-program-selection'
import { buildPercentageLineControlTasks } from './percentage-line-tasks'

const line = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', category: 'II', groupName: 'A', weldControlPercent: 100, pvkControlPercent: 100, version: '1', configurationIssue: null }
const row = (id: number, patch: Partial<WeldRow> = {}): WeldRow => ({ ...line, id, joint: 'F' + id, connectionType: 'С17', weldDate: '2026-09-01', stamp1K: 'A', ...patch })
// Expected values come from the agreed maximum-candidate rule, not the previous UI's theoretical deficit.
describe('assignment cap agreed in the plan and reconfirmed on 28 September', () => {
  it('keeps the original norm and rejected history without an impossible assignment debt', () => {
    const rows = [1, 2, 3, 4].map(id => row(id, { hasRk: 'да', hasPvk: 'да' })).concat(row(5, { vikResult: 'ремонт', vikConclusion: 'VIK-REJECT' }))
    const before = structuredClone(rows)
    const groups = calculateLineProgram(rows, 100, 100), display = buildLineProgramDisplay(rows, groups, 100, 100), overview = summarizeLineProgram(rows, line)
    for (const kind of ['common', 'pvk'] as const) {
      expect(compactLineProgramDemand(groups[0][kind])).toMatchObject({ required: 5, actionableRequired: 4, covered: 4, missing: 0 })
      expect(display.summary[kind]).toMatchObject({ required: 5, actionableRequired: 4, covered: 4, missing: 0 })
      expect(overview[kind]).toMatchObject({ required: 5, actionableRequired: 4, covered: 4, missing: 0 })
      expect(createProgramRowSelector(rows, groups, 1, new Set())({ slice: 'missing', kind })).toEqual([])
    }
    expect(buildPercentageLineControlTasks(rows).filter(task => task.issue === 'missing')).toEqual([])
    expect(rows).toEqual(before)
  })
  it.each([['F6', false], ['F5R1', false], ['F5W1', true]] as const)('only a new primary connection restores demand; %s follows its physical role', (joint, performed) => {
    const original = [1, 2, 3, 4].map(id => row(id, { hasRk: 'да', hasPvk: 'да' })).concat(row(5, { vikResult: 'ремонт' }))
    const next = row(6, { joint, weldDate: '2026-09-02' })
    for (const assigned of [false, true]) {
      const rows = [...original, { ...next, ...(assigned ? { hasRk: 'да', hasPvk: 'да', ...(performed ? { rkResult: 'годен', pvkResult: 'годен' } : {}) } : {}) }]
      const display = buildLineProgramDisplay(rows, calculateLineProgram(rows, 100, 100), 100, 100)
      const primary = joint === 'F6'
      for (const kind of ['common', 'pvk'] as const) expect(display.summary[kind]).toMatchObject({ required: primary ? 6 : 5, actionableRequired: primary ? 5 : 4, covered: primary && assigned ? 5 : 4, missing: primary && !assigned ? 1 : 0 })
      expect(buildPercentageLineControlTasks(rows).filter(task => task.issue === 'missing')).toHaveLength(primary && !assigned ? 2 : 0)
    }
  })
  it.each([[100, 5, 1], [50, 10, 6]])('caps PVK at the available four assignments: %s%% of %s with %s cancelled', (percent, count) => {
    const rows = Array.from({ length: count }, (_, i) => row(i + 1, { weldControlPercent: percent, pvkControlPercent: percent, hasPvk: i < 4 ? 'да' : 'отменен' }))
    const display = buildLineProgramDisplay(rows, calculateLineProgram(rows, percent, percent), percent, percent)
    expect(display.summary.pvk).toMatchObject({ required: 5, actionableRequired: 4, covered: 4, cancelled: count - 4, missing: 0 })
  })
})
