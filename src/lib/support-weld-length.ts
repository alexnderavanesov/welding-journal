import { isTConnectionType } from './connection-type'
import type { WeldRow } from './dispatcher-types'
import { parseJointName } from './joint-name'
import { getRepeatedJointNameFromParsed } from './joint-chain'
import { programJointIdentity } from './line-program-topology'
import { isUnofficialJoint } from './joint-display'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'
import type { WeldInput } from './weld-field-definitions'
import { normalizeSupportWeldLength, isPositiveSupportWeldLength } from './support-length-value'
export { normalizeSupportWeldLength } from './support-length-value'

export function isSupportRepair(row: WeldInput, settings: SystemIndexSettings = loadSystemIndexSettings()) {
  return isTConnectionType(row.connectionType) && ((row as WeldRow).programChainState?.kind === 'repair' ||
    parseJointName(row.joint, settings).segments.some(segment => segment.suffix === 'R'))
}

export const SUPPORT_REPAIR_LENGTH_REASON = 'Длина ремонта наследуется от исходной опоры. Исправьте длину исходного ОП — она обновится во всей ремонтной цепочке.'

/** Inputs are freshly stored rows under the line lock. Stable physical IDs keep
 * unrelated namesakes separate and survive moves and officiality rebuilds. */
export function getSupportLengthSynchronizations(
  rows: readonly WeldRow[],
  written: readonly WeldInput[],
  previous: ReadonlyMap<number, WeldInput>,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
  rebuilt = false,
) {
  const byId = new Map(rows.map(row => [row.id, row]))
  // Length needs only root identity. Do not traverse every ancestor of every
  // repair: a long legacy R chain must remain a linear pass as well.
  const identities = new Map<string, { total: number; official: number; only: number; officialId: number }>()
  for (const row of rows) {
    const key = programJointIdentity(row)
    const identity = identities.get(key) ?? { total: 0, official: 0, only: row.id, officialId: row.id }
    identity.total += 1
    if (!isUnofficialJoint(row)) { identity.official += 1; identity.officialId = row.id }
    identities.set(key, identity)
  }
  const states = new Map<number, { kind: 'primary' | 'repair' | 'coil'; physicalRootId: number | null }>(rows.map(row => {
    if (row.programChainState) return [row.id, row.programChainState] as const
    const branch = getRepeatedJointNameFromParsed(parseJointName(row.joint, settings), settings)
    const identity = identities.get(programJointIdentity(row, branch.base))
    const rootId = identity?.official === 1 ? identity.officialId : identity?.total === 1 ? identity.only : null
    return [row.id, { kind: branch.segments.length ? 'repair' : 'primary', physicalRootId: branch.segments.length ? rootId : row.id }] as const
  }))
  const roots = new Set<number>()
  for (const record of written) {
    if (!isTConnectionType(record.connectionType)) continue
    const id = Number(record.id)
    const old = previous.get(id)
    const changed = normalizeSupportWeldLength(record.weldLength) !== normalizeSupportWeldLength(old?.weldLength)
    if (!rebuilt && old && !changed) continue
    const state = states.get(id)
    const root = state?.physicalRootId == null ? undefined : byId.get(state.physicalRootId)
    if (!root || !isTConnectionType(root.connectionType)) {
      if (!rebuilt && (changed || !old) && isSupportRepair(record, settings)) throw new Error('Не найдена исходная опора для наследования длины. Сначала исправьте целостность цепочки.')
      continue
    }
    const rootLength = normalizeSupportWeldLength(root.weldLength)
    if (rootLength !== null && !isPositiveSupportWeldLength(rootLength)) throw new Error('Длина исходной опоры должна быть положительной или пустой.')
    if (!rebuilt && state?.kind === 'repair') {
      const length = normalizeSupportWeldLength(record.weldLength)
      if ((old && changed) || (!old && length !== null && length !== rootLength)) throw new Error(SUPPORT_REPAIR_LENGTH_REASON)
    }
    roots.add(root.id)
  }
  return rows.flatMap(row => {
    const rootId = states.get(row.id)?.physicalRootId
    if (!isTConnectionType(row.connectionType) || rootId == null || !roots.has(rootId)) return []
    const length = normalizeSupportWeldLength(byId.get(rootId)!.weldLength)
    return normalizeSupportWeldLength(row.weldLength) === length ? [] : [{ id: row.id, weldLength: length }]
  })
}
