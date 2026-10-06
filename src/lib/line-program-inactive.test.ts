import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import type { LineProgramRecord } from './line-program'
import { calculateLineProgram } from './line-program-calculation'
import { summarizeLineProgram } from './line-program-overview'
import { createProgramRowSelector } from './line-program-selection'
import { explainLineProgram } from './line-program-explanation'
import { programApprovalKey } from './program-control-approval'
import { isProgramEditableRow, type ProgramSlice } from './line-program-workspace'

const line: LineProgramRecord = { id: 1, line: 'L', projectTitle: 'P', subtitleCode: 'S', category: 'II', groupName: 'A', weldControlPercent: 10, pvkControlPercent: 10, configurationIssue: null, version: '1' }
const joint = (id: number, extra: Partial<WeldRow> = {}): WeldRow => ({ id, joint: `F${id}`, line: 'L', projectTitle: 'P', subtitleCode: 'S', connectionType: 'У19', weldDate: '2026-09-01', stamp1K: 'A', hasRk: 'дополнительный', hasUzk: 'да', hasPvk: 'дополнительный', ...extra })
const rows = [joint(1), joint(2, { officiality: 'неофициальный', rkResult: 'ремонт' }), joint(3, { revisionActuality: 'не актуален', rkResult: 'годен' }), joint(4, { officiality: 'неофициальный', revisionActuality: 'не актуален', rkResult: 'ремонт' })]
const approved = new Set(rows.map(row => programApprovalKey(row, 'common', true)))

describe('inactive joints remain historical rows, not contributions to the line program', () => {
  it.each([0, 1, 10, 100])('excludes all inactive statuses from quotas, counters and their lists at percent %i', percent => {
    const program = { ...line, weldControlPercent: percent, pvkControlPercent: percent }
    const active = [rows[0]]
    const groups = calculateLineProgram(rows, percent, percent, undefined, approved)
    const activeGroups = calculateLineProgram(active, percent, percent, undefined, approved)
    expect(groups).toEqual(activeGroups)
    expect(summarizeLineProgram(rows, program, approved)).toEqual({ ...summarizeLineProgram(active, program, approved), journalRows: rows.length })
    const select = createProgramRowSelector(rows, groups, line.id, approved)
    const activeSelect = createProgramRowSelector(active, activeGroups, line.id, approved)
    expect(select({ slice: 'all' })).toEqual(rows)
    expect(rows.map(isProgramEditableRow)).toEqual([true, false, false, false])
    const slices: ProgramSlice[] = ['additional', 'approved', 'assigned', 'covered', 'missing', 'reduction', 'excess', 'results', 'cancelled', 'duplicates', 'candidates']
    for (const slice of slices) for (const kind of [undefined, 'common', 'pvk'] as const) for (const stamp of [undefined, 'A']) {
      expect(select({ slice, kind, stamp }), `${slice}/${kind}/${stamp}`).toEqual(activeSelect({ slice, kind, stamp }))
    }
  })
  it.each(['additional', 'approved'] as const)('excludes inactive rows from the %s explanation as well as its list', list => {
    for (const percent of [10, 100]) for (const kind of ['common', 'pvk'] as const) for (const stamp of [undefined, 'A']) {
      const options = { kind, list, stamp, page: 0, approved }
      expect(explainLineProgram(rows, percent, percent, options)).toEqual(explainLineProgram([rows[0]], percent, percent, options))
    }
  })
  it('reinstates stored assignments and approvals only when both exclusion flags are removed', () => {
    const officialOnly = { ...rows[3], officiality: 'действующий' }
    expect(summarizeLineProgram([officialOnly], line, approved)).toMatchObject({ joints: 0, additional: 0, approved: 0 })
    const restored = { ...officialOnly, revisionActuality: 'актуальная' }
    expect(summarizeLineProgram([restored], line, approved)).toMatchObject({ joints: 1, additional: 1, approved: 1 })
    expect(approved.size).toBe(4)
    expect(rows[3].hasRk).toBe('дополнительный')
  })
})
