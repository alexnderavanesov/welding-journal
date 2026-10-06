import type { WeldRow } from './dispatcher-types'
import { formatRepeatedJointName, parseJointChainName, parseRepeatedJointName } from './joint-chain'
import { programJointIdentity } from './line-program-topology'
import { compareJointChainRows } from './repeated-joint-row-utils'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'

export type ProgramChainState = {
  weldJointId: number
  kind: 'primary' | 'repair' | 'coil'
  physicalRootId: number | null
  sourceRowId: number | null
  coilParentId: number | null
  coilSide: number | null
  replacedByCoil: boolean
  replacementCoilIds?: number[]
}

/** Only for a validated, explicitly confirmed officiality/chain rebuild. Ordinary
 * edits, deletes and moves must keep the stable identities captured below.
 * Reclassification must never undo a recorded physical coil replacement.
 */
export function captureRebuiltProgramChainStates(rows: readonly WeldRow[], settings?: SystemIndexSettings) {
  const states = captureProgramChainStates(rows.map(({ programChainState: _state, ...row }) => row), settings)
  const oldStates = new Map(rows.map(row => [row.id, row.programChainState]))
  for (const row of rows) {
    const previousRootId = row.programChainState?.physicalRootId
    if (previousRootId != null && oldStates.get(previousRootId)?.replacedByCoil &&
      states.get(row.id)!.physicalRootId !== previousRootId) {
      throw new Error('Сначала завершите проверку ошибочной катушки и отдельно подтвердите восстановление исходного соединения по СП-04. Изменение официальности не отменяет физическую замену катушкой.')
    }
    if (!row.programChainState?.replacedByCoil) continue
    Object.assign(states.get(row.id)!, {
      replacedByCoil: true,
      replacementCoilIds: row.programChainState.replacementCoilIds,
    })
  }
  return states
}

/** New system state can be inferred only from the actual complete saved context. Once
 * captured, object IDs and replacement facts are stable across deletion and renaming.
 * No control fact, assignment, stamp or document is changed here.
 */
export function captureProgramChainStates(rows: readonly WeldRow[], settings: SystemIndexSettings = loadSystemIndexSettings()) {
  const byIdentity = new Map<string, WeldRow[]>()
  const branches = new Map<string, WeldRow[]>()
  const parsed = new Map(rows.map(row => [row.id, parseRepeatedJointName(String(row.joint ?? ''), settings)]))
  for (const row of rows) {
    const key = programJointIdentity(row), bucket = byIdentity.get(key) ?? []
    bucket.push(row); byIdentity.set(key, bucket)
    const branchKey = programJointIdentity(row, parsed.get(row.id)!.base), branch = branches.get(branchKey) ?? []
    branch.push(row); branches.set(branchKey, branch)
  }
  const unique = (key: string) => {
    const matches = byIdentity.get(key) ?? []
    const official = matches.filter(row => String(row.officiality ?? '').toLocaleLowerCase('ru') !== 'неофициальный')
    return official.length === 1 ? official[0] : matches.length === 1 ? matches[0] : undefined
  }
  const states = new Map<number, ProgramChainState>()
  for (const row of rows) {
    if (row.programChainState) { states.set(row.id, { ...row.programChainState }); continue }
    const branch = parsed.get(row.id)!
    const chain = parseJointChainName(String(row.joint ?? ''), settings)
    const coil = !branch.segments.length && chain.segments.at(-1)?.suffix === 'Y'
    const root = branch.segments.length ? unique(programJointIdentity(row, branch.base)) : row
    const parentName = coil ? formatRepeatedJointName(chain.base, chain.segments.slice(0, -1), settings) : ''
    const parent = coil ? unique(programJointIdentity(row, parentName)) : undefined
    const sourceBranch = branches.get(programJointIdentity(row, coil ? parentName : branch.base)) ?? []
    const earlier = branch.segments.length ? sourceBranch.filter(candidate => {
      const parts = parsed.get(candidate.id)!.segments
      return candidate.id !== row.id && parts.length <= branch.segments.length &&
        parts.every((part, i) => part.suffix === branch.segments[i].suffix &&
          (i < parts.length - 1 ? part.index === branch.segments[i].index : part.index <= branch.segments[i].index)) &&
        (parts.length < branch.segments.length || parts.some((part, i) => part.index < branch.segments[i].index))
    }) : coil ? sourceBranch : []
    const source = earlier.sort((a, b) => compareJointChainRows(a, b, settings)).at(-1)
    states.set(row.id, { weldJointId: row.id, kind: branch.segments.length ? 'repair' : coil ? 'coil' : 'primary',
      physicalRootId: root?.id ?? null, sourceRowId: source?.id ?? null, coilParentId: parent?.id ?? null,
      coilSide: coil ? chain.segments.at(-1)!.index : null, replacedByCoil: false })
  }
  const weldedSides = new Map<number, Set<number>>()
  const weldedIds = new Map<number, number[]>()
  for (const row of rows) {
    const state = states.get(row.id)!
    if (state.kind !== 'coil' || state.coilParentId == null || !row.weldDate || state.coilSide == null) continue
    const sides = weldedSides.get(state.coilParentId) ?? new Set<number>()
    sides.add(state.coilSide); weldedSides.set(state.coilParentId, sides)
    const ids = weldedIds.get(state.coilParentId) ?? []
    ids.push(row.id); weldedIds.set(state.coilParentId, ids)
  }
  for (const [parentId, sides] of weldedSides) {
    const parent = states.get(parentId)
    if (parent && !parent.replacedByCoil && sides.has(1) && sides.has(2)) {
      parent.replacedByCoil = true
      parent.replacementCoilIds = weldedIds.get(parentId)!.sort((a, b) => a - b)
    }
  }
  return states
}
