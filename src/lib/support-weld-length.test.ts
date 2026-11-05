import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { getSupportLengthSynchronizations, SUPPORT_REPAIR_LENGTH_REASON } from './support-weld-length'
import { getSupportJointRuleIssues } from './support-joint-rules'
import { captureProgramChainStates } from './line-program-chain-state'

const row = (id: number, joint: string, weldLength: number | string | null = 600.123456): WeldRow => ({ id, joint, weldLength, connectionType: 'Т1', projectTitle: 'P', subtitleCode: 'S', line: 'L' })

describe('Т-04: one full length per physical support', () => {
  it.each(['850.987654321987654321', null])('propagates original length %s to every repair, including unofficial and inactive rows', length => {
    const original = row(1, 'ОП-1')
    const saved = { ...original, weldLength: length }
    const rows = [saved, row(2, 'ОП-1R1'), { ...row(3, 'ОП-1R12'), officiality: 'неофициальный', revisionActuality: 'не актуальна' }, row(4, 'ОП-2')]
    expect(getSupportLengthSynchronizations(rows, [saved], new Map([[1, original]]))).toEqual([{ id: 2, weldLength: length }, { id: 3, weldLength: length }])
    expect(rows[1].weldLength).toBe(600.123456)
  })
  it('uses stable physical IDs across namesakes and moved/renamed histories', () => {
    const original = row(1, 'ОП-1')
    const repair = row(2, 'ОП-1R1')
    const states = captureProgramChainStates([original, repair])
    const rows = [{ ...original, joint: 'ОП-legacy', weldLength: 900, officiality: 'неофициальный', programChainState: states.get(1) },
      { ...repair, programChainState: states.get(2) }, row(3, 'ОП-1', 700)]
    expect(getSupportLengthSynchronizations(rows, [rows[0]], new Map([[1, original]]))).toEqual([{ id: 2, weldLength: '900' }])
  })
  it('inherits full length for a newly created blank repair, without treating zero as blank', () => {
    const original = row(1, 'ОП-1')
    const repair = row(2, 'ОП-1R1', null)
    expect(getSupportLengthSynchronizations([original, repair], [repair], new Map())).toEqual([{ id: 2, weldLength: String(original.weldLength) }])
    expect(() => getSupportLengthSynchronizations([original, { ...repair, weldLength: 0 }], [{ ...repair, weldLength: 0 }], new Map())).toThrow(SUPPORT_REPAIR_LENGTH_REASON)
  })
  it('rejects separate repair edits even when the same batch changes the original', () => {
    const original = row(1, 'ОП-1'), repair = row(2, 'ОП-1R1')
    const next = [{ ...original, weldLength: 700 }, { ...repair, weldLength: 700 }]
    expect(() => getSupportLengthSynchronizations(next, next, new Map([[1, original], [2, repair]]))).toThrow(SUPPORT_REPAIR_LENGTH_REASON)
    expect(getSupportJointRuleIssues(next[1], repair).map(issue => issue.message).join(' ')).toContain(SUPPORT_REPAIR_LENGTH_REASON)
    expect(getSupportJointRuleIssues({ ...repair, weldingJournalNote: 'исправление' }, repair)).toEqual([])
  })
  it('preserves unrelated facts on a repair included in the original correction batch', () => {
    const original = row(1, 'ОП-1'), repair = row(2, 'ОП-1R1')
    const saved = [{ ...original, weldLength: 777.125 }, { ...repair, weldingJournalNote: 'Исправление', uzkResult: 'ремонт' }]
    expect(getSupportLengthSynchronizations(saved, saved, new Map([[1, original], [2, repair]]))).toEqual([{ id: 2, weldLength: '777.125' }])
    expect(saved[1].uzkResult).toBe('ремонт')
  })
  it('aligns length to the rebuilt physical root without changing independent supports', () => {
    const original = row(1, 'ОП-1', 800), repair = row(2, 'ОП-1R1', 600)
    expect(getSupportLengthSynchronizations([original, repair, row(3, 'ОП-2', 900)], [repair], new Map(), undefined, true)).toEqual([{ id: 2, weldLength: '800' }])
  })
  it('rejects a new orphan repair and keeps an unchanged existing orphan available for unrelated correction', () => {
    const repair = row(2, 'ОП-1R1')
    expect(() => getSupportLengthSynchronizations([repair], [repair], new Map())).toThrow('Не найдена исходная опора')
    expect(getSupportLengthSynchronizations([repair], [repair], new Map([[2, repair]]))).toEqual([])
  })
})
