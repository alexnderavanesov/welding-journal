import { describe, expect, it } from 'vitest'
import { findFirstNewLnkChronologySaveBlockReason, getLnkChronologyIssues } from './lnk-chronology-checks'
import { findFirstNewPstoChronologySaveBlockReason, getPstoChronologyIssues } from './psto-chronology-checks'
import type { WeldInput } from './weld-fields'

describe('historical chronology belongs to a record, not its displayed joint name', () => {
  it('preserves existing LNK history on system rename but never exempts another record or changed dates', () => {
    const previous: WeldInput = { id: 1, joint: 'F1R1W1', weldDate: '2026-09-03',
      hasRk: 'да', rkResult: 'годен', rkRequest: 'R', rkRequestDate: '2026-09-05', rkConclusionDate: '2026-09-04' }
    expect(getLnkChronologyIssues([previous]).length).toBeGreaterThan(0)
    const renamed = { ...previous, joint: 'F1R1', hasVik: 'да' }
    expect(findFirstNewLnkChronologySaveBlockReason([renamed], [previous])).toBe('')
    expect(findFirstNewLnkChronologySaveBlockReason([{ ...renamed, id: 2 }], [previous])).not.toBe('')
    expect(findFirstNewLnkChronologySaveBlockReason([{ ...renamed, rkConclusionDate: '2026-09-03' }], [previous])).not.toBe('')
  })
  it('preserves the same PSTO date violation through a rename, without allowing another date or record', () => {
    const previous: WeldInput = { id: 1, joint: 'F1R1W1', weldDate: '2026-09-03', pstoRequired: 'да',
      pstoRequest: 'P', pstoRequestDate: '2026-09-04', pstoResult: 'проведено', pstoDate: '2026-09-03' }
    expect(getPstoChronologyIssues([previous]).length).toBeGreaterThan(0)
    const renamed = { ...previous, joint: 'F1R1' }
    expect(findFirstNewPstoChronologySaveBlockReason([renamed], [previous])).toBe('')
    expect(findFirstNewPstoChronologySaveBlockReason([{ ...renamed, id: 2 }], [previous])).not.toBe('')
    expect(findFirstNewPstoChronologySaveBlockReason([{ ...renamed, pstoDate: '2026-09-02' }], [previous])).not.toBe('')
  })
})
