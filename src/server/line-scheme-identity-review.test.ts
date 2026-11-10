import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { appSettings, duplicateControls, lineSchemeMembers, preHeatTreatmentControls, weldJoints, weldJointProgramStates } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { captureProgramChainStates } from '@/lib/line-program-chain-state'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import { syncSchemePhysicalMembership } from './line-scheme-identity'
import { readSchemeTopology } from './line-scheme-read'
import { syncRebuiltProgramChainStates } from './program-chain-rebuild'

const settings = DEFAULT_SYSTEM_INDEX_SETTINGS
const row = (id: number, patch: Partial<WeldRow> = {}): WeldRow => ({ id, lineProgramId: 7, projectTitle: 'P', subtitleCode: 'C', line: 'L', joint: 'S1', weldDate: '2026-11-01',
  hasVik: 'да', hasRk: 'да', hasUzk: null, hasPvk: null, vikResult: null, rkResult: null, uzkResult: null, pvkResult: null, ...patch })
const pre = { id: 41, weldJointId: 1, method: 'РК', result: 'ремонт' }

function fixture(rows: WeldRow[], preControls: typeof pre[] = []) {
  const states = captureProgramChainStates(rows, settings), members = new Map([[1, 101]])
  const writes: { weldJointId: number; physicalId: number }[] = []
  const select = vi.fn((fields?: Record<string, unknown>) => {
    let table: unknown
    const result = () => table === appSettings ? [] : table === weldJointProgramStates ? [...states.values()] : table === lineSchemeMembers ? [...members].map(([weldJointId, physicalId]) => ({ weldJointId, physicalId }))
      : table === preHeatTreatmentControls ? preControls : table === duplicateControls ? [] : table === weldJoints ? fields?.row ? rows.map(value => ({ row: value, state: states.get(value.id) })) : rows : []
    const query: any = { from: (value: unknown) => { table = value; return query }, where: () => query, orderBy: () => query, leftJoin: () => query, innerJoin: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject) }
    return query
  })
  const tx = { select, execute: vi.fn().mockResolvedValue({ rows: [] }), insert: vi.fn((table: unknown) => ({ values: (records: typeof writes) => ({ onConflictDoNothing: async () => {
    expect(table).toBe(lineSchemeMembers)
    for (const record of records) { writes.push(record); if (!members.has(record.weldJointId)) members.set(record.weldJointId, record.physicalId) }
  } }) })) }
  return { tx, states, members, writes }
}

describe('durable scheme membership for official same-name continuations', () => {
  it.each(['primary', 'pre-heat'] as const)('records live official continuation before its %s rejected source can be deleted', async kind => {
    const rows = [row(1, { officiality: 'неофициальный', ...(kind === 'primary' ? { rkResult: 'ремонт' } : {}) }), row(2)]
    const f = fixture(rows, kind === 'pre-heat' ? [pre] : [])
    await syncSchemePhysicalMembership(f.tx as never, rows, f.states)
    expect(f.members.get(2)).toBe(101)
    await syncSchemePhysicalMembership(f.tx as never, [rows[1]], f.states, new Map([[1, rows[0]]]))
    expect(f.members.get(2)).toBe(101)
  })

  it('loads pre-TO rejection evidence before resolving a point to the official namesake', async () => {
    const rows = [row(1, { officiality: 'неофициальный' }), row(2)]
    const f = fixture(rows, [pre])
    const topology = await readSchemeTopology(f.tx as never, [7])
    expect(topology.groups.get(7)?.find(group => group.physicalId === 101)?.representative?.id).toBe(2)
  })

  it('does not bind a newly created same-name object to a deleted predecessor', async () => {
    const previous = row(1, { officiality: 'неофициальный', rkResult: 'ремонт' }), created = row(2)
    const f = fixture([created])
    await syncSchemePhysicalMembership(f.tx as never, [created], f.states, new Map([[1, previous]]))
    expect(f.members.has(2)).toBe(false)
  })

  it('does not infer a pre-TO rejection for an unassigned method', async () => {
    const rows = [row(1, { officiality: 'неофициальный', hasRk: 'нет' }), row(2)]
    const f = fixture(rows, [pre])
    await syncSchemePhysicalMembership(f.tx as never, rows, f.states)
    expect(f.members.has(2)).toBe(false)
  })

  it('preserves a newly official namesake even when no program-state rename is needed', async () => {
    const rows = [row(1, { officiality: 'неофициальный', rkResult: 'ремонт' }), row(2)]
    const f = fixture(rows)
    await syncRebuiltProgramChainStates(f.tx as never, rows.map(value => ({ ...value, programChainState: f.states.get(value.id) })), [], settings)
    expect(f.members.get(2)).toBe(101)
  })

  it.each([1, 2000])('reads compact topology for %i physical groups with four batched queries', async count => {
    const rows = Array.from({ length: count }, (_, index) => row(index + 1, { joint: `S${index + 1}`, lineProgramId: index % 50 + 1, line: `L${index % 50 + 1}` }))
    const f = fixture(rows)
    const topology = await readSchemeTopology(f.tx as never, [...new Set(rows.map(value => value.lineProgramId!))])
    expect([...topology.groups.values()].flat()).toHaveLength(count)
    expect(f.tx.select).toHaveBeenCalledTimes(4)
    expect(f.tx.insert).not.toHaveBeenCalled()
    expect(f.tx.execute).not.toHaveBeenCalled()
  })

  it('keeps a future R on the surviving official identity while Y starts separately', async () => {
    const rows = [row(2, { rkResult: 'ремонт' }), row(3, { joint: 'S1R1', rkResult: 'вырез' }), row(4, { joint: 'S1R1Y1' }), row(5, { joint: 'S1R1Y2' })]
    const f = fixture(rows)
    f.members.set(2, 101)
    await syncSchemePhysicalMembership(f.tx as never, rows, f.states)
    expect(f.members.get(3)).toBe(101)
    expect(f.members.has(4)).toBe(false)
    expect(f.members.has(5)).toBe(false)
  })

  it('retains the last repair label on bulk deletion even when imported IDs run backwards', async () => {
    const previous = [row(1, { joint: 'S1R1' }), row(2, { rkResult: 'ремонт' })]
    const f = fixture([])
    f.members.set(2, 101)
    await syncSchemePhysicalMembership(f.tx as never, [], f.states, new Map(previous.map(value => [value.id, value])))
    const query = new PgDialect().sqlToQuery(f.tx.execute.mock.calls[0][0])
    expect(query.params).toEqual([101, 'S1R1', 7])
  })

  it('rejects a concurrent first placement that assigned the continuation another identity', async () => {
    const rows = [row(1, { officiality: 'неофициальный', rkResult: 'ремонт' }), row(2)]
    const f = fixture(rows)
    f.tx.insert.mockImplementationOnce(() => ({ values: () => ({ onConflictDoNothing: async () => { f.members.set(2, 202) } }) }))
    await expect(syncSchemePhysicalMembership(f.tx as never, rows, f.states)).rejects.toThrow('изменилась параллельно')
    expect(f.tx.execute).not.toHaveBeenCalled()
  })
})
