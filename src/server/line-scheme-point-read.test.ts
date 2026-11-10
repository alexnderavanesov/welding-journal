import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { appSettings, duplicateControls, lineSchemeBundles, lineSchemeMembers, lineSchemeRevisions, preHeatTreatmentControls, pstoRepeatCycles, weldJoints, weldJointProgramStates } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ProgramChainState } from '@/lib/line-program-chain-state'
import { normalizeJointChainPart } from '@/lib/joint-chain'
import { hydrateSchemeGroups, readSchemeDraftStates, readSchemePointTopology } from './line-scheme-read'

const dbSlot = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/db', () => ({ requireDb: () => ({ transaction: (run: (db: unknown) => unknown) => run(dbSlot.current) }) }))
const row = (id: number, patch: Partial<WeldRow> = {}): WeldRow => ({ id, lineProgramId: 7, projectTitle: 'P', subtitleCode: 'C', line: 'L', joint: `S${id}`, weldDate: '2026-11-01', hasVik: 'да', vikResult: 'годен', hasRk: null, rkResult: null, hasUzk: null, uzkResult: null, hasPvk: null, pvkResult: null,
  programChainState: { weldJointId: id, kind: 'primary', physicalRootId: id, sourceRowId: null, coilParentId: null, coilSide: null, replacedByCoil: false }, ...patch })

function fixture(input: WeldRow[], pairs: [number, number][] = []) {
  const byId = new Map(input.map(value => [value.id, value])), byName = new Map<string, WeldRow[]>(), byPhysical = new Map<number, number[]>(), memberships = new Map(pairs)
  const states = new Map(input.flatMap(value => value.programChainState ? [[value.id, value.programChainState] as const] : [])), byRoot = new Map<number, ProgramChainState[]>(), byParent = new Map<number, ProgramChainState[]>()
  for (const value of input) { const name = normalizeJointChainPart(value.joint), bucket = byName.get(name) ?? []; bucket.push(value); byName.set(name, bucket) }
  for (const value of states.values()) {
    if (value.physicalRootId != null) { const bucket = byRoot.get(value.physicalRootId) ?? []; bucket.push(value); byRoot.set(value.physicalRootId, bucket) }
    if (value.coilParentId != null) { const bucket = byParent.get(value.coilParentId) ?? []; bucket.push(value); byParent.set(value.coilParentId, bucket) }
  }
  for (const [id, physical] of pairs) { const bucket = byPhysical.get(physical) ?? []; bucket.push(id); byPhysical.set(physical, bucket) }
  const metrics = { fullLineReads: 0, ids: new Set<number>(), states: new Set<number>(), queries: [] as string[] }
  const select = vi.fn((fields?: Record<string, unknown>) => {
    let table: unknown, condition: SQL
    const result = () => {
      const query = new PgDialect().sqlToQuery(condition), idsFor = (tableName: string, field: string): number[] => {
        const match = query.sql.match(new RegExp(`"${tableName}"\\."${field}" = any\\(\\$(\\d+)::integer\\[\\]\\)`))
        return match ? query.params[Number(match[1]) - 1] as number[] : []
      }
      metrics.queries.push(query.sql)
      if (table === appSettings || table === lineSchemeRevisions || table === preHeatTreatmentControls || table === pstoRepeatCycles || table === duplicateControls) return []
      if (table === lineSchemeBundles) return [{ bundle: { id: 1, lineProgramId: 7, projectTitle: 'P', subtitleCode: 'C', line: 'L', activeRevisionId: null, version: 1 }, line: { id: 7, projectTitle: 'P', subtitleCode: 'C', line: 'L' } }]
      if (table === lineSchemeMembers) {
        const ids = new Set([...idsFor('line_scheme_members', 'weld_joint_id'), ...idsFor('line_scheme_members', 'physical_id').flatMap(id => byPhysical.get(id) ?? [])])
        return [...ids].flatMap(id => memberships.has(id) ? [{ weldJointId: id, physicalId: memberships.get(id)! }] : [])
      }
      if (table === weldJointProgramStates) {
        const found = [...idsFor('weld_joint_program_states', 'weld_joint_id').flatMap(id => states.has(id) ? [states.get(id)!] : []),
          ...idsFor('weld_joint_program_states', 'physical_root_id').flatMap(id => byRoot.get(id) ?? []), ...idsFor('weld_joint_program_states', 'coil_parent_id').flatMap(id => byParent.get(id) ?? [])]
        for (const value of found) metrics.states.add(value.weldJointId)
        return [...new Map(found.map(value => [value.weldJointId, value])).values()]
      }
      if (table === weldJoints) {
        const ids = idsFor('weld_joints', 'id'), nameMatch = query.sql.match(/= any\(\$(\d+)::text\[\]\)/)
        const names = nameMatch ? query.params[Number(nameMatch[1]) - 1] as string[] : []
        let found = [...ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []), ...names.flatMap(name => byName.get(name) ?? [])]
        if (fields?.row) {
          if (!ids.length && !names.length) { metrics.fullLineReads++; found = input }
          found = found.filter(value => value.lineProgramId === 7)
        }
        found = [...new Map(found.map(value => [value.id, value])).values()]
        for (const value of found) metrics.ids.add(value.id)
        return fields?.row ? found.map(value => ({ row: Object.fromEntries(Object.keys(fields.row as Record<string, unknown>).map(key => [key, value[key as keyof WeldRow]])), state: value.programChainState ?? null })) : found.map(value => ({ ...value }))
      }
      throw new Error('Unexpected read')
    }
    const query: any = { from: (value: unknown) => { table = value; return query }, where: (value: SQL) => { condition = value; return query }, innerJoin: () => query, leftJoin: () => query, orderBy: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject) }
    return query
  })
  const db = { select, execute: vi.fn() }; dbSlot.current = db
  return { db, metrics }
}

describe('saved point SQL scope', () => {
  it('hydrates details of an inactive point from its displayed row, not the compact topology', async () => {
    const f = fixture([row(1, { officiality: 'неофициальный', material1: '20', d1: 57, stamp1K: 'A', stamp1KFact: 'B' })], [[1, 101]])
    const topology = await readSchemePointTopology(f.db as never, 7, [101])
    const groups = topology.groups.get(7)!
    expect(groups[0].representative).toBeNull()
    expect(groups[0].displayRow.material1).toBeUndefined()
    const details = await hydrateSchemeGroups(f.db as never, groups, topology)
    expect(details.get(groups[0].key)).toMatchObject({ color: 'inactive', weldInfo: { date: '2026-11-01', material1: '20', d1: 57, stamp1: 'A', stamp1Fact: 'B' } })
  })

  it.each([500, 200_000])('selects only 500 saved physicals from %i journal records', async count => {
    const input = Array.from({ length: count }, (_, index) => row(index + 1)), pairs = input.map(value => [value.id, 1000 + value.id] as [number, number])
    const f = fixture(input, pairs)
    const topology = await readSchemePointTopology(f.db as never, 7, pairs.slice(0, 500).map(([, id]) => id))
    expect(topology.groups.get(7)).toHaveLength(500)
    expect(f.metrics.fullLineReads).toBe(0)
    expect([...f.metrics.ids].sort((a, b) => a - b)).toEqual(Array.from({ length: 500 }, (_, index) => index + 1))
    expect(f.metrics.states.size).toBe(500)
    expect(f.db.select).toHaveBeenCalledTimes(7)
    expect(f.metrics.queries.some(query => query.includes('lower(translate(coalesce("weld_joints"."joint",'))).toBe(true)
    expect(f.db.execute).not.toHaveBeenCalled()
  })
})

describe('unsaved draft states', () => {
  it('returns fresh states for every supplied root, including a repaired root and off-list roots', async () => {
    const input = Array.from({ length: 65 }, (_, index) => row(index + 1))
    input[0].vikResult = 'ремонт'
    input.push(row(100, { joint: 'S1R1', programChainState: { ...row(100).programChainState!, kind: 'repair', physicalRootId: 1, sourceRowId: 1 } }))
    fixture(input)
    const result = await readSchemeDraftStates({ bundleId: 1, roots: [1, 65] })
    expect(result).toEqual([expect.objectContaining({ rootId: 1, rowId: 100, label: 'S1R1', color: 'good' }), expect.objectContaining({ rootId: 65, rowId: 65, color: 'good' })])
  })

  it('does not rebind deleted or moved roots to a newly reused name', async () => {
    fixture([row(2, { lineProgramId: 8 }), row(3, { joint: 'S1' })])
    const result = await readSchemeDraftStates({ bundleId: 1, roots: [1, 2] })
    expect(result).toEqual([expect.objectContaining({ rootId: 1, rowId: null, color: 'inactive', reason: 'Исходный стык удалён.' }), expect.objectContaining({ rootId: 2, rowId: null, color: 'inactive', reason: 'Исходный стык перенесён в другую линию.' })])
  })

  it('requires reselection when an unsaved computational root changed without a durable identity', async () => {
    fixture([row(1, { officiality: 'неофициальный', vikResult: 'ремонт' }), row(2, { joint: 'S1' })])
    expect(await readSchemeDraftStates({ bundleId: 1, roots: [1] })).toEqual([expect.objectContaining({ rootId: 1, physicalId: null, rowId: null, color: 'error' })])
  })

  it('validates batch limits before opening a database snapshot', async () => {
    await expect(readSchemeDraftStates({ bundleId: 1, roots: Array.from({ length: 501 }, (_, index) => index + 1) })).rejects.toThrow('500')
    await expect(readSchemeDraftStates({ bundleId: 1, roots: [0] })).rejects.toThrow('недопустимое')
  })
})
