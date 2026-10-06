import { expect, it, vi } from 'vitest'
import { syncRebuiltProgramChainStates } from './program-chain-rebuild'
import { captureProgramChainStates } from '@/lib/line-program-chain-state'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import type { WeldRow } from '@/lib/dispatcher-types'

it('does no additional SQL when officiality does not require a rename', async () => {
  const tx = { select: vi.fn(), insert: vi.fn() }
  await syncRebuiltProgramChainStates(tx as never, [], [], DEFAULT_SYSTEM_INDEX_SETTINGS)
  expect(tx.select).not.toHaveBeenCalled()
  expect(tx.insert).not.toHaveBeenCalled()
})

it.each([24, 1024, 200_000].flatMap(count => [false, true].map(restore => ({ count, restore }))))('one affected chain among $count rows, restore=$restore: one compact state read and one write', async ({ count, restore }) => {
  const rows: WeldRow[] = Array.from({ length: count }, (_, index) => ({ id: index + 1, joint: `S${index + 1}`, line: 'L' }))
  rows[0].officiality = restore ? 'неофициальный' : null
  rows[1].joint = restore ? 'S1' : 'S1R1'
  const prior = captureProgramChainStates(rows.slice(0, 2))
  rows[0].officiality = restore ? null : 'неофициальный'
  rows[1].joint = restore ? 'S1R1' : 'S1'
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ orderBy: () => [...prior.values()] }) }) }))
  const values = vi.fn((_states: unknown[]) => ({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }))
  await syncRebuiltProgramChainStates({ select, insert: () => ({ values }) } as never, rows, [2], DEFAULT_SYSTEM_INDEX_SETTINGS)
  expect(select).toHaveBeenCalledTimes(1)
  expect(values).toHaveBeenCalledTimes(1)
  expect(values.mock.calls[0][0]).toEqual([expect.objectContaining(restore
    ? { weldJointId: 2, kind: 'repair', physicalRootId: 1, sourceRowId: 1 }
    : { weldJointId: 2, kind: 'primary', physicalRootId: 2, sourceRowId: null })])
})
