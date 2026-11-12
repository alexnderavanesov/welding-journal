import { expect, it, vi } from 'vitest'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import { loadPhysicalChainContexts } from './physical-chain-context'

vi.mock('./line-program', () => ({ lineProgramWeldWhere: vi.fn(), loadProgramSystemIndexSettings: async () => DEFAULT_SYSTEM_INDEX_SETTINGS }))
vi.mock('./weld-validation-settings-lock', () => ({ lockWeldValidationSettings: vi.fn() }))
vi.mock('./line-program-chain-state', () => ({ attachProgramChainStates: async (rows: unknown[]) => rows }))

const row = (id: number, line: string) => ({ id, projectTitle: 'P', subtitleCode: 'S', line,
  joint: id === 1 ? 'F1' : 'F1R1', updatedAt: new Date('2026-11-12T00:00:00Z'),
  programChainState: { weldJointId: id, kind: id === 1 ? 'primary' : 'repair', physicalRootId: 1,
    sourceRowId: id === 1 ? null : 1, coilParentId: null, coilSide: null, replacedByCoil: false } })

async function contexts(rows: ReturnType<typeof row>[]) {
  const results = [rows, rows, rows, rows, rows.map(row => ({ id: row.id, rootId: 1 }))]
  const tx = { execute: vi.fn(), select: () => {
    const result = results.shift()
    const query: any = { from: () => query, where: () => query, orderBy: () => query,
      innerJoin: () => query, for: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) }
    return query
  } }
  return loadPhysicalChainContexts(tx as never, rows.map(row => row.id))
}

it.each(['line', 'projectTitle', 'subtitleCode'] as const)('rejects a saved chain spanning different %s even when every member is selected', async key => {
  const other = { ...row(2, 'L1'), [key]: 'OTHER' }
  const result = await contexts([row(1, 'L1'), other])
  expect(result).toHaveLength(1)
  expect(result[0].reason).toContain('СП-09')
})

it('permits a whole-chain move and normalized equivalent line identities', async () => {
  const result = await contexts([row(1, 'MOVED'), row(2, ' MOVED ')])
  expect(result).toHaveLength(1)
  expect(result[0].reason).toBeNull()
})
