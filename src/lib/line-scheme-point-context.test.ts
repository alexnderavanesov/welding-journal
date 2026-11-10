import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import type { ProgramChainState } from './line-program-chain-state'
import { DEFAULT_SYSTEM_INDEX_SETTINGS as settings } from './system-index-settings'
import { normalizeJointChainPart } from './joint-chain'
import { collectSchemePointContext, type SchemePointContextSource } from './line-scheme-point-context'
import { buildSchemePhysicalGroups, projectSchemeJoint } from './line-scheme-physical'

const state = (id: number, patch: Partial<ProgramChainState> = {}): ProgramChainState => ({ weldJointId: id, kind: 'primary', physicalRootId: id, sourceRowId: null, coilParentId: null, coilSide: null, replacedByCoil: false, ...patch })
const row = (id: number, patch: Partial<WeldRow> = {}): WeldRow => ({ id, lineProgramId: 7, projectTitle: 'P', subtitleCode: 'C', line: 'L', joint: `S${id}`, weldDate: '2026-11-01', hasVik: 'да', vikResult: 'годен', programChainState: state(id), ...patch })

function indexedSource(input: WeldRow[], memberships: [number, number][], historical: ProgramChainState[] = []) {
  const byId = new Map(input.map(value => [value.id, value])), byName = new Map<string, WeldRow[]>(), byPhysical = new Map<number, number[]>()
  const states = new Map([...historical, ...input.flatMap(value => value.programChainState ? [value.programChainState] : [])].map(value => [value.weldJointId, value]))
  const byRoot = new Map<number, ProgramChainState[]>(), byParent = new Map<number, ProgramChainState[]>(), membership = new Map(memberships)
  for (const value of input) { const name = normalizeJointChainPart(value.joint), bucket = byName.get(name) ?? []; bucket.push(value); byName.set(name, bucket) }
  for (const value of states.values()) {
    if (value.physicalRootId != null) { const bucket = byRoot.get(value.physicalRootId) ?? []; bucket.push(value); byRoot.set(value.physicalRootId, bucket) }
    if (value.coilParentId != null) { const bucket = byParent.get(value.coilParentId) ?? []; bucket.push(value); byParent.set(value.coilParentId, bucket) }
  }
  for (const [id, physicalId] of memberships) { const bucket = byPhysical.get(physicalId) ?? []; bucket.push(id); byPhysical.set(physicalId, bucket) }
  const readIds = new Set<number>(), readNames = new Set<string>(), returnedRows = new Set<number>(), readStates = new Set<number>(), requests: string[] = []
  const source: SchemePointContextSource = {
    members: async query => {
      requests.push('members')
      const ids = new Set([...(query.nodeIds ?? []), ...(query.physicalIds ?? []).flatMap(id => byPhysical.get(id) ?? [])])
      return [...ids].flatMap(id => membership.has(id) ? [{ weldJointId: id, physicalId: membership.get(id)! }] : [])
    },
    states: async query => {
      requests.push('states')
      const found = [...(query.nodeIds ?? []).flatMap(id => states.has(id) ? [states.get(id)!] : []), ...(query.rootIds ?? []).flatMap(id => byRoot.get(id) ?? []), ...(query.coilParentIds ?? []).flatMap(id => byParent.get(id) ?? [])]
      for (const value of found) readStates.add(value.weldJointId)
      return [...new Map(found.map(value => [value.weldJointId, value])).values()]
    },
    rows: async query => {
      requests.push('rows'); expect((query.ids?.length ?? 0) + (query.names?.length ?? 0)).toBeGreaterThan(0)
      for (const id of query.ids ?? []) readIds.add(id)
      for (const name of query.names ?? []) readNames.add(name)
      const found = [...(query.ids ?? []).flatMap(id => byId.has(id) ? [byId.get(id)!] : []), ...(query.names ?? []).flatMap(name => byName.get(name) ?? [])].filter(value => value.lineProgramId === 7)
      for (const value of found) returnedRows.add(value.id)
      return [...new Map(found.map(value => [value.id, value])).values()]
    },
  }
  return { source, readIds, readNames, returnedRows, readStates, requests }
}

describe('saved scheme point context scope', () => {
  it.each([500, 200_000])('reads the same 500 physicals among %i unrelated journal rows', async count => {
    const input = Array.from({ length: count }, (_, index) => row(index + 1))
    const memberships = Array.from({ length: count }, (_, index) => [index + 1, index + 1001] as [number, number])
    const f = indexedSource(input, memberships)
    const context = await collectSchemePointContext(memberships.slice(0, 500).map(([, id]) => id), settings, f.source)
    expect(context.requiresFullLine).toBe(false)
    expect(context.rows.map(value => value.id)).toEqual(Array.from({ length: 500 }, (_, index) => index + 1))
    expect(f.returnedRows.size).toBe(500)
    expect(f.readStates.size).toBe(500)
    expect(f.readIds.size).toBe(500)
    expect(f.readNames.size).toBe(1500) // 500 live names and their two possible Y names.
    expect(f.requests).toEqual(['members', 'states', 'rows', 'rows', 'states', 'rows'])
  })

  it('includes the full conflicting root reached through a live official alias', async () => {
    const input = [row(1, { joint: ' S \t1 ', officiality: 'неофициальный', vikResult: 'ремонт' }), row(2, { joint: 'S1', vikResult: 'ремонт' }),
      row(3, { joint: 'S1R1', programChainState: state(3, { kind: 'repair', physicalRootId: 2, sourceRowId: 2 }) }), row(4)]
    const f = indexedSource(input, [[1, 101], [2, 102]])
    const context = await collectSchemePointContext([101], settings, f.source)
    expect(context.rows.map(value => value.id)).toEqual([1, 2, 3])
    const group = buildSchemePhysicalGroups(context.rows, settings, context.membership, context.states).find(value => value.physicalId === 101)!
    expect(projectSchemeJoint(group, context.rows, settings).color).toBe('error')
  })

  it('does not attach a new same-name object after the saved root was deleted', async () => {
    const f = indexedSource([row(2, { joint: 'S1' })], [[1, 101]], [state(1)])
    const context = await collectSchemePointContext([101], settings, f.source)
    expect(context.rows).toEqual([])
    expect(f.readNames.size).toBe(0)
  })

  it('keeps a moved predecessor absent from the current line even while reading its state', async () => {
    const input = [row(1, { lineProgramId: 8 }), row(2, { joint: 'S1R1', programChainState: state(2, { kind: 'repair', physicalRootId: 1, sourceRowId: 1 }) })]
    const f = indexedSource(input, [[1, 101], [2, 101]])
    const context = await collectSchemePointContext([101], settings, f.source)
    expect(context.rows.map(value => value.id)).toEqual([2])
    const group = buildSchemePhysicalGroups(context.rows, settings, context.membership, context.states)[0]
    expect(projectSchemeJoint(group, context.rows, settings).color).toBe('error')
  })

  it.each([null, '2026-11-02'])('reads Y welding evidence without traversing Y repairs (second date %s)', async weldDate => {
    const input = [row(1, { vikResult: 'вырез' }), row(2, { joint: 'S1Y1', programChainState: state(2, { kind: 'coil', coilParentId: 1, coilSide: 1 }) }),
      row(3, { joint: 'S1Y2', weldDate, programChainState: state(3, { kind: 'coil', coilParentId: 1, coilSide: 2 }) }),
      row(4, { joint: 'S1Y1R1', programChainState: state(4, { kind: 'repair', physicalRootId: 2, sourceRowId: 2 }) })]
    const f = indexedSource(input, [[1, 101], [2, 102], [3, 103], [4, 102]])
    const context = await collectSchemePointContext([101], settings, f.source)
    expect(context.rows.map(value => value.id)).toEqual([1, 2, 3])
    const group = buildSchemePhysicalGroups(context.rows, settings, context.membership, context.states).find(value => value.physicalId === 101)!
    expect(projectSchemeJoint(group, context.rows, settings).color).toBe(weldDate ? 'inactive' : 'rejected')
  })

  it.each(['root', 'coil'] as const)('requires the canonical full-line fallback for a legacy %s without saved state', async kind => {
    const input = kind === 'root' ? [row(1, { programChainState: undefined })] : [row(1), row(2, { joint: 'S1Y1', programChainState: undefined })]
    const context = await collectSchemePointContext([101], settings, indexedSource(input, [[1, 101]]).source)
    expect(context.requiresFullLine).toBe(true)
  })
})
