import { describe, expect, it, vi } from 'vitest'
import { syncProgramChainStates } from './line-program-chain-state'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('stable program topology query budget', () => {
  it('captures physical before-state when the first structural touch deletes both legacy sides', async () => {
    const root = { id: 1, joint: 'S1', line: 'L', weldDate: '2026-09-01' }
    const sides = [2, 3].map((id, index) => ({ ...root, id, joint: `S1Y${index + 1}` }))
    const results = [[root], [], []]
    const select = vi.fn(() => {
      const result = results.shift()
      const query = { from: () => query, where: () => Object.assign(Promise.resolve(result), { orderBy: () => Promise.resolve(result) }) }
      return query
    })
    const values = vi.fn((_batch: unknown[]) => ({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }))
    await syncProgramChainStates({ select, insert: () => ({ values }) } as never, [], new Map(sides.map(row => [row.id, row])))
    expect(values.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ weldJointId: 1, replacedByCoil: true, replacementCoilIds: [2, 3] }),
      expect.objectContaining({ weldJointId: 2, kind: 'coil', coilParentId: 1 }),
      expect.objectContaining({ weldJointId: 3, kind: 'coil', coilParentId: 1 }),
    ]))
  })
  it('does not read or write topology for a control-only mutation', async () => {
    const tx = { select: vi.fn(), insert: vi.fn() }
    const previous = { id: 1, joint: 'F1', projectTitle: 'P', subtitleCode: 'S', line: 'L', weldDate: '2026-09-01' }
    await syncProgramChainStates(tx as never, [{ ...previous, hasRk: 'да' }], new Map([[1, previous]]))
    expect(tx.select).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
  })
  it.each([1, 2000])('uses three batched reads and capped inserts for %i joints on one affected line', async count => {
    const rows: WeldRow[] = Array.from({ length: count }, (_, i) => ({ id: i + 1, joint: `F${i + 1}`, projectTitle: 'P', subtitleCode: 'S', line: 'L', weldDate: '2026-09-01' }))
    const results = [rows, [], []]
    const select = vi.fn(() => {
      const result = results.shift()
      const query = { from: () => query, where: () => Object.assign(Promise.resolve(result), { orderBy: () => Promise.resolve(result) }) }
      return query
    })
    const values = vi.fn((_batch: unknown[]) => ({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }))
    const insert = vi.fn(() => ({ values }))
    await syncProgramChainStates({ select, insert } as never, rows, new Map())
    expect(select).toHaveBeenCalledTimes(3)
    expect(insert).toHaveBeenCalledTimes(Math.ceil(count / 1000))
    expect(values.mock.calls.every(call => call[0].length <= 1000)).toBe(true)
  })
})
