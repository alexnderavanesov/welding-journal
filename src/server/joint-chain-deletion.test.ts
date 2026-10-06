import { describe, expect, it, vi } from 'vitest'
import { assertJointChainRowsCanBeDeleted } from './joint-chain-deletion'

describe('chain deletion bounded query budget', () => {
  it.each([1, 1000])('uses four reads for %i selected primary joints on one line', async count => {
    const rows = Array.from({ length: count }, (_, i) => ({ id: i + 1, joint: `F${i + 1}`, line: 'L', projectTitle: 'P' }))
    const answers = [rows, [], []]
    const select = vi.fn(() => {
      const answer = answers.shift()
      const query = { from: () => query, where: () => Object.assign(Promise.resolve(answer), { orderBy: () => Promise.resolve(answer) }) }
      return query
    })
    const execute = vi.fn().mockResolvedValue({ rows: [] })
    await assertJointChainRowsCanBeDeleted({ select, execute } as never, rows)
    expect(select).toHaveBeenCalledTimes(3)
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('does not issue any queries for an empty selection', async () => {
    const tx = { select: vi.fn(), execute: vi.fn() }
    await assertJointChainRowsCanBeDeleted(tx as never, [])
    expect(tx.select).not.toHaveBeenCalled()
    expect(tx.execute).not.toHaveBeenCalled()
  })
})
