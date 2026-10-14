import { describe, expect, it } from 'vitest'
import { getRetainedChainDependants } from './joint-chain-deletion'
import { captureProgramChainStates } from './line-program-chain-state'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import type { WeldRow } from './dispatcher-types'

const row = (id: number, joint: string, extra: Partial<WeldRow> = {}): WeldRow => ({
  id, joint, projectTitle: 'P', subtitleCode: 'S', line: 'L', ...extra,
})
const remaining = (rows: WeldRow[], ids: number[]) => getRetainedChainDependants(rows, new Set(ids)).map(r => r.id)

describe('deletion preserves every remaining continuation', () => {
  it.each([
    ['S63', 'S63W1', 'S63W1R1', 'S63W2R1'],
    ['S63', 'S63R1', 'S63R1W1', 'S63R2W1'],
    ['S63Y1', 'S63Y1W1', 'S63Y1W1R1', 'S63Y1W2R1'],
    ['S63', 'S63W1R1', 'S63W2R1', 'S63W2R2'],
  ])('keeps the immediate mixed predecessor in %s -> %s -> %s -> %s', (...names) => {
    const rows = names.map((joint, i) => row(i + 1, joint)).reverse()
    expect(captureProgramChainStates(rows).get(4)?.sourceRowId).toBe(3)
    expect(remaining(rows, [3])).toEqual([4])
    expect(remaining(rows, [2, 3])).toEqual([4])
    expect(remaining(rows, [4])).toEqual([])
    expect(remaining(rows, [3, 4])).toEqual([])
    const saved = captureProgramChainStates(rows)
    const moved = rows.map(item => ({ ...item, programChainState: saved.get(item.id),
      ...(item.id === 4 ? { line: 'Moved', joint: 'Renamed', officiality: 'неофициальный', revisionActuality: 'не актуален' } : {}) }))
    expect(remaining(moved, [3])).toEqual([4])
    expect(captureProgramChainStates(moved).get(4)).toEqual(saved.get(4))
  })
  it('does not use a higher counter, a sibling suffix order or another coil side as the source', () => {
    const rows = [row(1, 'S63Y1'), row(2, 'S63Y1W1R1'), row(3, 'S63Y1W2R1'),
      row(4, 'S63Y1W1R2'), row(5, 'S63Y1R1W1'), row(6, 'S63Y2W1R1')]
    expect(captureProgramChainStates(rows).get(3)?.sourceRowId).toBe(2)
    for (const id of [4, 5, 6]) expect(remaining(rows, [id])).not.toContainEqual(expect.objectContaining({ id: 3 }))
  })
  it('keeps an already captured identity without automatically repairing old stored links', () => {
    const rows = [row(1, 'S63'), row(2, 'S63W1'), row(3, 'S63W1R1'), row(4, 'S63W2R1')]
    const stored = { ...captureProgramChainStates(rows).get(4)!, sourceRowId: 2 }
    rows[3].programChainState = stored
    expect(captureProgramChainStates(rows).get(4)).toEqual(stored)
    expect(rows[3].programChainState).toBe(stored)
  })
  it('supports configured W/R suffixes in mixed chains', () => {
    const rows = [row(1, 'B1'), row(2, 'B1X1'), row(3, 'B1X1C1'), row(4, 'B1X2C1')]
    const settings = { ...DEFAULT_SYSTEM_INDEX_SETTINGS, fieldJoint: 'B', repair: 'C', cutout: 'X' }
    expect(captureProgramChainStates(rows, settings).get(4)?.sourceRowId).toBe(3)
    expect(getRetainedChainDependants(rows, new Set([3]), settings).map(item => item.id)).toEqual([4])
  })
  const chain = [row(1, 'S1'), row(2, 'S1R1'), row(3, 'S1R2'), row(4, 'S1Y1'), row(5, 'S1Y2'), row(6, 'S1Y1R1')]
  it('protects root, intermediate repair and each coil side with a repair', () => {
    expect(remaining(chain, [1])).toEqual([2, 3, 4, 5, 6])
    expect(remaining(chain, [2])).toEqual([3, 4, 5, 6])
    expect(remaining(chain, [4])).toEqual([6])
  })
  it('allows tails and whole selected branches, but never a partial branch', () => {
    expect(remaining(chain, [6])).toEqual([])
    expect(remaining(chain, [4, 6])).toEqual([])
    expect(remaining(chain, [1, 2, 3, 4, 5, 6])).toEqual([])
    expect(remaining(chain, [1, 2, 3, 4, 5])).toEqual([6])
  })
  it('does not confuse similar names or separate lines with the same names', () => {
    expect(remaining([row(1, 'S1'), row(2, 'S10R1'), row(3, 'S1R1', { line: 'OTHER' })], [1])).toEqual([])
  })
  it.each([
    { officiality: 'неофициальный' }, { revisionActuality: 'не актуален' },
    { officiality: 'неофициальный', revisionActuality: 'не актуален' },
  ])('does not let flags erase a dependant: %j', flags => {
    expect(remaining([row(1, 'S1'), row(2, 'S1R1', flags)], [1])).toEqual([2])
  })
  it('protects both unofficial and official same-name continuations', () => {
    expect(remaining([row(1, 'S1'), row(2, 'S1R1', { officiality: 'неофициальный' }), row(3, 'S1R1')], [1])).toEqual([2, 3])
  })
  it('honors configured suffixes for legacy rows', () => {
    expect(getRetainedChainDependants([row(1, 'B1'), row(2, 'B1C1'), row(3, 'B1E1')], new Set([1]), {
      ...DEFAULT_SYSTEM_INDEX_SETTINGS, fieldJoint: 'B', repair: 'C', coil: 'E',
    }).map(r => r.id)).toEqual([2, 3])
  })
  it('follows stored IDs even after moving and renaming a dependant', () => {
    const states = captureProgramChainStates(chain)
    const moved = chain.map(r => ({ ...r, programChainState: states.get(r.id), ...(r.id > 1 ? { line: 'OTHER', joint: `F${r.id}` } : {}) }))
    expect(remaining(moved, [1])).toEqual([2, 3, 4, 5, 6])
  })
  it('terminates on damaged cyclic ID history', () => {
    const states = captureProgramChainStates(chain.slice(0, 2))
    states.get(1)!.sourceRowId = 2
    const rows = chain.slice(0, 2).map(r => ({ ...r, programChainState: states.get(r.id) }))
    expect(remaining(rows, [1])).toEqual([2])
    expect(remaining(rows, [1, 2])).toEqual([])
  })
})
