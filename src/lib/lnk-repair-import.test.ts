import { describe, expect, it } from 'vitest'
import { assertNoLnkResultRuleIssues } from './lnk-result-policy'
import { normalizeSaveCheckSettings } from './save-check-settings'
import { getWeldFormSaveBlockReason } from './weld-form-save-reasons'
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
    ).toThrow(/СП-07.*Ремонт/)
  })

  it('checks existing row imports when D1 or D2 makes an existing repair forbidden', () => {
    const currentRows = [
      { id: 1, joint: 'F1', d1: 100, d2: 100, rkResult: 'ремонт', finalStatus: 'не годен' } as WeldRow,
    ]
    const updatedRows = [
      { ...currentRows[0], d1: 57, d2: 57 } as WeldRow,
    ]

    expect(() => assertNoLnkResultRuleIssues(updatedRows)).toThrow('57 мм')
  })

  it('checks the final stored facts even during unrelated existing row updates', () => {
    const currentRows = [
      { id: 1, joint: 'F1', d1: 57, d2: 57, rkResult: 'ремонт', responsible: 'old', finalStatus: 'не годен' } as WeldRow,
    ]
    const updatedRows = [
      { ...currentRows[0], responsible: 'new' } as WeldRow,
    ]

    expect(() => assertNoLnkResultRuleIssues(updatedRows)).toThrow('СП-07')
  })

  it('does not allow an old disabled repair setting to bypass SP-05', () => {
    expect(getWeldFormSaveBlockReason({ joint: 'F1', d1: 57, d2: 57, rkResult: 'ремонт' }, {},
      normalizeSaveCheckSettings({ lnkResultRepairRules: false }))).toContain('СП-07')
  })
})
