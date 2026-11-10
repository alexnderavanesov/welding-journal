import { expect, it, vi } from 'vitest'
import { syncRebuiltProgramChainStates } from './program-chain-rebuild'
import { captureProgramChainStates } from '@/lib/line-program-chain-state'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import { lineSchemeMembers, weldJointProgramStates } from '@/db/schema'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

it('does no additional SQL for an empty officiality scope', async () => {
  const tx = { select: vi.fn(), insert: vi.fn() }
  await syncRebuiltProgramChainStates(tx as never, [], [], DEFAULT_SYSTEM_INDEX_SETTINGS)
  expect(tx.select).not.toHaveBeenCalled()
  expect(tx.insert).not.toHaveBeenCalled()
})

it.each([24, 1024, 200_000].flatMap(count => [false, true].map(restore => ({ count, restore }))))('one affected chain among $count rows, restore=$restore: one compact state read, one membership probe and one write', async ({ count, restore }) => {
  const rows: WeldRow[] = Array.from({ length: count }, (_, index) => ({ id: index + 1, joint: `S${index + 1}`, line: 'L' }))
  rows[0].officiality = restore ? 'неофициальный' : null
  rows[1].joint = restore ? 'S1' : 'S1R1'
  const prior = captureProgramChainStates(rows.slice(0, 2))
  rows[0].officiality = restore ? null : 'неофициальный'
  rows[1].joint = restore ? 'S1R1' : 'S1'
  const reads: { table: unknown; ids: number[] }[] = []
  const select = vi.fn(() => {
    let table: unknown, ids: number[] = []
    const query: any = { from: (value: unknown) => { table = value; return query }, where: (condition: SQL) => {
      ids = new PgDialect().sqlToQuery(condition).params[0] as number[]
      reads.push({ table, ids }); return query
    }, orderBy: () => query, then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      if (table === weldJointProgramStates) return Promise.resolve(ids.flatMap(id => prior.has(id) ? [prior.get(id)!] : [])).then(resolve, reject)
      if (table === lineSchemeMembers) return Promise.resolve([]).then(resolve, reject)
      throw new Error('Unexpected query: rebuild must not load journal or control history without tracked identities')
    } }
    return query
  })
  const values = vi.fn((_states: unknown[]) => ({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }))
  await syncRebuiltProgramChainStates({ select, insert: () => ({ values }) } as never, rows, [2], DEFAULT_SYSTEM_INDEX_SETTINGS)
  expect(select).toHaveBeenCalledTimes(2)
  expect(reads.map(read => read.table)).toEqual([weldJointProgramStates, lineSchemeMembers])
  expect(reads[0].ids).toEqual([1, 2])
  expect(reads[1].ids).toHaveLength(count)
  expect(values).toHaveBeenCalledTimes(1)
  expect(values.mock.calls[0][0]).toEqual([expect.objectContaining(restore
    ? { weldJointId: 2, kind: 'repair', physicalRootId: 1, sourceRowId: 1 }
    : { weldJointId: 2, kind: 'primary', physicalRootId: 2, sourceRowId: null })])
})
