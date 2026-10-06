import { describe, expect, it } from 'vitest'
import { countUnfinishedProgramChains } from './line-program-completion'
import { captureProgramChainStates } from './line-program-chain-state'
import { isLineProgramFinished, summarizeLineProgram } from './line-program-overview'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import type { WeldRow } from './dispatcher-types'
import { getEarlyCoilDecisionKey } from './early-coil-decision'

const root: WeldRow = { id: 1, joint: 'S1', line: 'L', connectionType: 'С17', stamp1K: 'A', weldDate: '2026-09-01', hasVik: 'да', vikResult: 'годен', hasUzk: 'да', uzkResult: 'ремонт' }
const repair: WeldRow = { ...root, id: 2, joint: 'S1R1', weldDate: '2026-09-02', uzkResult: 'годен' }
const coils = [3, 4].map(id => ({ ...root, id, joint: `S1Y${id - 2}`, weldDate: '2026-09-03', uzkResult: 'годен' }))
const line = { id: 1, projectTitle: '', subtitleCode: '', line: 'L', category: 'II', groupName: 'A', weldControlPercent: 10, pvkControlPercent: 0, configurationIssue: null, version: '1' }
describe('completion of physical chains, independently of historical rejections', () => {
  it('excludes the entire obsolete original but keeps good coil connections complete', () => {
    const rows = [root, { ...repair, uzkResult: 'вырез' }].map(row => ({ ...row, revisionActuality: 'не актуален' }))
    const accepted = new Set([getEarlyCoilDecisionKey(2)])
    expect(summarizeLineProgram([...rows, ...coils], line, accepted)).toMatchObject({ joints: 2, calculationJoints: 2, unfinishedChains: 0 })
    expect(countUnfinishedProgramChains([root, { ...repair, revisionActuality: 'не актуален' }, { ...repair, id: 5, joint: 'S1R2' }], false)).toBeGreaterThan(0)
  })
  it('finishes a good repair without deleting the root rejection or its surcharge', () => {
    const result = summarizeLineProgram([root, repair], line)
    expect(result).toMatchObject({ joints: 1, rejected: 1, unfinishedChains: 0, common: { required: 3, missing: 0 } })
    expect(isLineProgramFinished(result)).toBe(true)
    expect(isLineProgramFinished({ ...result, common: { ...result.common!, missing: 1 } })).toBe(false)
  })
  it('finishes two good coil sides after a failed repair, including repair of a side', () => {
    const rows = [root, { ...repair, uzkResult: 'вырез' }, ...coils]
    const accepted = new Set([getEarlyCoilDecisionKey(2)])
    expect(countUnfinishedProgramChains(rows, false, undefined, accepted)).toBe(0)
    expect(summarizeLineProgram(rows, line, accepted)).toMatchObject({ joints: 2, rejected: 2, unfinishedChains: 0 })
    expect(countUnfinishedProgramChains(rows, false)).toBeGreaterThan(0) // premature coil without an accepted decision
    expect(countUnfinishedProgramChains([root, { ...repair, uzkResult: 'вырез' }, { ...coils[0], uzkResult: 'ремонт' }, coils[1], { ...coils[0], id: 5, joint: 'S1Y1R1' }], false, undefined, accepted)).toBe(0)
  })
  it.each([
    [root], [root, { ...repair, uzkResult: 'ремонт' }],
    [root, { ...repair, officiality: 'неофициальный' }], [root, { ...repair, revisionActuality: 'не актуален' }],
    [{ ...root, uzkResult: 'годен' }, repair], [root, repair, { ...repair, id: 5 }],
    [root, { ...repair, uzkResult: null }], [root, { ...repair, weldDate: null }],
    [root, { ...repair, hasUzk: null, uzkResult: null }],
    [root, { ...repair, uzkResult: 'вырез' }, coils[0]],
    [root, { ...repair, uzkResult: 'вырез' }, ...coils.map(row => ({ ...row, uzkResult: null }))],
  ])('does not turn a partial/contradictory chain green', (...rows) => {
    expect(countUnfinishedProgramChains(rows, false)).toBeGreaterThan(0)
  })
  it('preserves missing-coil debt after both sides were removed', () => {
    const states = captureProgramChainStates([root, ...coils])
    expect(countUnfinishedProgramChains([{ ...root, uzkResult: 'годен', programChainState: states.get(1) }], false)).toBeGreaterThan(0)
  })
  it('uses configured indexes and never lets another physical chain close this one', () => {
    expect(countUnfinishedProgramChains([root, { ...repair, joint: 'S1Q1' }], false, { ...DEFAULT_SYSTEM_INDEX_SETTINGS, repair: 'Q' })).toBe(0)
    expect(countUnfinishedProgramChains([root, { ...repair, id: 3, joint: 'S2' }], false)).toBe(1)
  })
})
