import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { assertNoNewLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { assertNoNewPstoChronologyIssues } from '@/lib/psto-chronology-checks'
import { buildSystemDocumentDateChangePlan } from '@/lib/system-document-date-change'
import { getNewChronologyRootCauseState } from '@/lib/workflow-root-cause-actions'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

describe('historical chronology exceptions belong to one weld, not its displayed number', () => {
  it.each([
    { label: 'LNK', check: assertNoNewLnkChronologyIssues, fields: { vikRequest: 'ВИК', vikRequestDate: '2026-03-05' } },
    { label: 'PSTO', check: assertNoNewPstoChronologyIssues, fields: { pstoRequest: 'ПСТО', pstoRequestDate: '2026-03-05' } },
  ])('$label does not let another F1 inherit an old date violation', ({ check, fields }) => {
    for (const identities of [
      [{ id: 1, line: 'L1' }, { id: 2, line: 'L1' }],
      [{ line: 'L1' }, { line: 'L2' }],
      [{ projectTitle: 'P1', line: 'L1' }, { projectTitle: 'P2', line: 'L1' }],
    ]) {
      const first = { ...identities[0], joint: 'F1', weldDate: '2026-03-10', ...fields } as WeldRow
      const second = { ...identities[1], joint: 'F1', weldDate: '2026-03-01', ...fields } as WeldRow
      expect(() => check([first, second], [first, second])).not.toThrow()
      expect(() => check([first, { ...second, weldDate: '2026-03-10' }], [first, second])).toThrow('раньше даты сварки')
    }
  })

  it('rejects a shared TVMT date change that creates the same error on a different same-number weld', () => {
    const common = {
      joint: 'F1', weldDate: '2026-03-01', pstoRequired: 'да', hasVik: 'да',
      pstoRequest: 'П', pstoRequestDate: '2026-03-03', pstoDate: '2026-03-04', pstoResult: 'проведено',
      tvmtRequest: 'Т', tvmtRequestDate: '2026-03-04', tvmtConclusionDate: '2026-03-10', tvmtConclusion: 'Общее ТВМТ',
      vikRequest: 'В', vikRequestDate: '2026-03-02', vikResult: 'годен', vikConclusionDate: '2026-03-15',
    }
    const previous = [
      { ...common, id: 1, line: 'L1', tvmtResult: 'не годен', pstoRepeatCycles: [{
        id: 101, weldJointId: 1, sequence: 2, pstoRequest: 'П-2', pstoRequestDate: '2026-03-20',
        pstoDate: '2026-03-20', pstoResult: 'проведено', tvmtRequest: 'Т-2', tvmtRequestDate: '2026-03-20',
        tvmtResult: 'годен', tvmtConclusionDate: '2026-03-20', tvmtConclusion: 'ТВМТ-2',
      }] },
      { ...common, id: 2, line: 'L2', tvmtResult: 'годен' },
    ] as WeldRow[]
    const plan = buildSystemDocumentDateChangePlan({
      reference: { type: 'lnkConclusion', methodCode: 'ТВМТ', sourceKind: 'pstoCycle', cycleSequences: [1], title: 'Общее ТВМТ', date: '2026-03-10' },
      rows: previous, nextDate: '2026-03-20',
      sourcePositions: previous.map((row) => ({ kind: 'pstoCycle', weldJointId: row.id, relationId: row.id, sequence: 1, methodCode: 'ТВМТ' })),
    })
    expect(() => assertNoNewPstoChronologyIssues(plan.rows, previous)).not.toThrow()
    expect(() => assertNoNewLnkChronologyIssues(plan.rows, previous)).toThrow('раньше ТВМТ')
    const preview = getNewChronologyRootCauseState({ previousRows: previous, proposedRows: plan.rows, settings: DEFAULT_SAVE_CHECK_SETTINGS })
    expect(preview.message).toContain('раньше ТВМТ')
    expect(preview.actions.every((action) => action.target.rowId === 2)).toBe(true)
  })
})
