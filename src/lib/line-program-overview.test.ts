import { describe, expect, it } from 'vitest'
import { isLineProgramFinished, summarizeLineProgram } from './line-program-overview'
import type { LineProgramRecord } from './line-program'

const line: LineProgramRecord = { id: 1, line: 'L', projectTitle: 'P', subtitleCode: 'S', category: 'II', groupName: 'A', weldControlPercent: 30, pvkControlPercent: 10, configurationIssue: null, version: '1' }
const row = { id: 1, joint: 'F1', connectionType: 'СШ', weldDate: '2026-09-01', stamp1K: 'A' }

describe('line card overview', () => {
  const good = { ...row, hasVik: 'да', vikResult: 'годен', hasRk: 'да', rkResult: 'годен', hasPvk: 'да', pvkResult: 'годен' }
  it('finishes only with closed needs and completed saved statuses, ignoring excluded records', () => {
    const complete = summarizeLineProgram([good,
      { ...good, id: 2, joint: 'F2', officiality: 'неофициальный', vikResult: 'ремонт' },
      { ...good, id: 3, joint: 'F3', revisionActuality: 'не актуален', hasRk: null, rkResult: 'годен' },
    ], line)
    expect(complete).toMatchObject({ joints: 1, pending: 0, rejected: 0 })
    expect(isLineProgramFinished(complete)).toBe(true)
    expect(isLineProgramFinished({ ...complete, common: { ...complete.common!, missing: 1 } })).toBe(false)
    expect(isLineProgramFinished({ ...complete, pvk: { ...complete.pvk!, missing: 1 } })).toBe(false)
    // Theoretical, unreachable quota is not revived as assignment debt by the border.
    expect(isLineProgramFinished({ ...complete, common: { ...complete.common!, required: 999 } })).toBe(true)
  })
  it('never marks an empty, unknown, merely assigned, rejected or erroneous line finished', () => {
    for (const overview of [undefined, null, summarizeLineProgram([], line),
      summarizeLineProgram([good], { ...line, configurationIssue: 'СП-02' }),
      summarizeLineProgram([{ ...good, rkResult: null }], line),
      summarizeLineProgram([{ ...good, vikResult: 'ремонт' }], line),
      summarizeLineProgram([{ ...good, hasRk: null }], line),
      summarizeLineProgram([{ ...good, officiality: 'неофициальный' }], line),
    ]) expect(isLineProgramFinished(overview)).toBe(false)
  })
  it('does not disguise an invalid legacy result as a waiting or good joint', () => {
    expect(summarizeLineProgram([{ ...row, rkResult: 'ремонт', hasRk: null }], line)).toMatchObject({ pending: 0, rejected: 0, errors: 1 })
  })
  it('uses card status including PSTO/TVMT cycles without changing control quotas', () => {
    const controlled = { ...row, preHeatTreatmentLnkEnabled: false, hasVik: 'да', vikResult: 'годен', hasRk: 'да', rkResult: 'годен', hasPvk: 'да', pvkResult: 'годен' }
    const failed = { ...controlled, pstoRequired: 'да', pstoRequest: 'ПСТО-1', pstoResult: 'проведено', pstoDate: '2026-09-02', tvmtRequest: 'ТВМТ-1', tvmtResult: 'не годен' }
    const fixed = { ...failed, pstoRepeatCycles: [{ id: 1, weldJointId: row.id, sequence: 2, pstoRequest: 'ПСТО-2', pstoResult: 'проведено', pstoDate: '2026-09-03', tvmtRequest: 'ТВМТ-2', tvmtResult: 'годен' }] }
    const plain = summarizeLineProgram([controlled], line)
    const waiting = summarizeLineProgram([failed], line)
    const complete = summarizeLineProgram([fixed], line)
    expect(plain).toMatchObject({ pending: 0, rejected: 0 })
    expect(waiting).toMatchObject({ pending: 1, rejected: 0 })
    expect(complete).toMatchObject({ pending: 0, rejected: 0 })
    expect(isLineProgramFinished(plain)).toBe(true)
    expect(isLineProgramFinished(waiting)).toBe(false)
    expect(isLineProgramFinished(complete)).toBe(true)
    expect(waiting.common).toEqual(plain.common)
    expect(waiting.pvk).toEqual(plain.pvk)
    expect(complete.common).toEqual(plain.common)
  })
  it('additional methods displace ordinary yes but never become excess or duplicates themselves', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ ...row, id: i + 1 }))
    const controlled = { ...rows[0], hasRk: 'да', hasPvk: 'да' }
    const additional = { ...rows[1], hasRk: 'дополнительный', hasUzk: 'дополнительный', hasPvk: 'дополнительный', rkResult: 'годен', pvkResult: 'годен' }
    const result = summarizeLineProgram([controlled, additional, ...rows.slice(2)], { ...line, weldControlPercent: 10 })
    expect(result).toMatchObject({ additional: 1, common: { covered: 1, excess: 1 }, pvk: { covered: 1, excess: 1 } })
    // A mixed joint remains one place. The other ordinary joint is displaced, not the additional method.
    const mixed = summarizeLineProgram([controlled, { ...additional, hasUzk: 'да' }, ...rows.slice(2)], { ...line, weldControlPercent: 10 })
    expect(mixed).toMatchObject({ additional: 1, common: { covered: 1, excess: 1 }, pvk: { excess: 1 } })
  })
  it('counts physical joints once, but keeps the separate quotas of each stamp', () => {
    const result = summarizeLineProgram([{ ...row, stamp1Z: 'B', stamp1O: 'a', hasRk: 'да' }], line)
    expect(result).toEqual({ joints: 1, journalRows: 1, calculationJoints: 1, stamps: 2, additional: 0, approved: 0, reducible: 0, pending: 1, rejected: 0, unfinishedChains: 1,
      common: { required: 2, actionableRequired: 2, covered: 2, missing: 0, excess: 0 }, pvk: { required: 2, actionableRequired: 2, covered: 0, missing: 2, excess: 0 } })
  })
  it('retains unknown requirements instead of presenting a false zero/complete state', () => {
    expect(summarizeLineProgram([row], { ...line, configurationIssue: 'СП-02', pvkControlPercent: null })).toMatchObject({ joints: 1, stamps: 1, common: null, pvk: null })
    expect(summarizeLineProgram([row], { ...line, weldControlPercent: 0, pvkControlPercent: 0 })).toMatchObject({ common: { required: 0 }, pvk: { required: 0 } })
  })
  it('includes planned stamps but excludes unofficial/obsolete ones without changing the welded calculation base', () => {
    const result = summarizeLineProgram([row, { ...row, id: 2, weldDate: null, stamp1K: 'B' }, { ...row, id: 3, officiality: 'неофициальный', stamp1K: 'C' }, { ...row, id: 4, revisionActuality: 'не актуален', stamp1K: 'D' }], line)
    expect(result).toMatchObject({ joints: 2, calculationJoints: 1, stamps: 2, common: { required: 1 }, pvk: { required: 1 } })
  })
  it('keeps missing work at one stamp visible even when another stamp exceeds its quota', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ ...row, id: i + 1, stamp1K: i < 5 ? 'A' : 'B', hasRk: i < 5 ? 'да' : null }))
    const result = summarizeLineProgram(rows, line)
    // Closed slots are capped per stamp: A's five assignments close its two slots,
    // never B's two missing slots. Extra assignments remain visible separately.
    expect(result.common).toMatchObject({ required: 4, actionableRequired: 4, covered: 2, missing: 2, excess: 3 })
  })
  it('preserves the original quota without assignment debt when no candidate can be assigned', () => {
    const result = summarizeLineProgram([{ ...row, vikResult: 'ремонт' }], line)
    expect(result.common).toMatchObject({ required: 1, actionableRequired: 0, covered: 0, missing: 0 })
  })
})
