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
