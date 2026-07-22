import { describe, expect, it } from 'vitest'
import { assertNoLnkRepairRuleIssues, getRowsWithChangedLnkRepairRuleInputs } from './lnk-result-rules'
import { DEFAULT_SAVE_CHECK_SETTINGS } from './save-check-settings'
import { prepareImportedWeldRecords } from './weld-journal-mutation-updates'
import type { WeldRow } from './dispatcher-types'

describe('LNK repair rule in imports', () => {
  it('rejects a new imported weld with repair on a small diameter', () => {
    expect(() =>
      prepareImportedWeldRecords({
        records: [{ joint: 'F1', d1: 57, d2: 57, rkResult: 'ремонт' }],
        weldFormStampSelectOptions: {},
        welderStamps: [],
        welderStampSuspensions: [],
      }),
    ).toThrow('ремонт')
  })

  it('checks existing row imports when D1 or D2 makes an existing repair forbidden', () => {
    const currentRows = [
      { id: 1, joint: 'F1', d1: 100, d2: 100, rkResult: 'ремонт', finalStatus: 'не годен' } as WeldRow,
    ]
    const updatedRows = [
      { ...currentRows[0], d1: 57, d2: 57 } as WeldRow,
    ]

    const rowsToCheck = getRowsWithChangedLnkRepairRuleInputs(updatedRows, currentRows)

    expect(rowsToCheck).toHaveLength(1)
    expect(() => assertNoLnkRepairRuleIssues(rowsToCheck, DEFAULT_SAVE_CHECK_SETTINGS)).toThrow('D1/D2')
  })

  it('does not check old repair rows during unrelated existing row updates', () => {
    const currentRows = [
      { id: 1, joint: 'F1', d1: 57, d2: 57, rkResult: 'ремонт', responsible: 'old', finalStatus: 'не годен' } as WeldRow,
    ]
    const updatedRows = [
      { ...currentRows[0], responsible: 'new' } as WeldRow,
    ]

    expect(getRowsWithChangedLnkRepairRuleInputs(updatedRows, currentRows)).toHaveLength(0)
  })

  it('respects the disabled repair rule setting', () => {
    expect(() =>
      assertNoLnkRepairRuleIssues(
        [{ joint: 'F1', d1: 57, d2: 57, rkResult: 'ремонт' }],
        { ...DEFAULT_SAVE_CHECK_SETTINGS, lnkResultRepairRules: false },
      ),
    ).not.toThrow()
  })
})
