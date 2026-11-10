import type { WeldRow } from './dispatcher-types'
import type { ProgramChainState } from './line-program-chain-state'
import { captureProgramChainStates } from './line-program-chain-state'
import { isActiveOfficialWeld } from './control-assignment-eligibility'
import type { SystemIndexSettings } from './system-index-settings'
import { buildJointChainContinuations } from './joint-chain-continuations'
import { isUnofficialJoint } from './joint-display'
import { compareJointChainRows } from './repeated-joint-row-utils'
import { buildFinalStatusRowsContext, calculateFinalStatusInRows, CONTROL_RESULT_PAIRS, normalizeResultStatus } from './weld-status'
import { getPrimaryRejectedLnkResult } from './repeated-joint-task-helpers'
import { getPreHeatTreatmentPendingFinalStatus } from './lnk-control-stage'
import { isControlEnabledValue } from './control-availability-values'
import { buildProgramRepairRequirements, satisfiesProgramRepairRequirement } from './line-program-repair-requirements'
import type { SchemeJoint } from './line-schemes'

export type SchemePhysicalGroup = {
  key: string; rootId: number; physicalId: number | null; rows: WeldRow[]; memberIds: number[];
  representative: WeldRow | null; displayRow: WeldRow; label: string; welded: boolean; inactive: string | null; issue: string | null
}

/** Complete compact line topology, never a filtered page of journal records.
 * Persisted membership bridges computational root changes, not Y boundaries.
 */
export function buildSchemePhysicalGroups(
  input: readonly WeldRow[], settings: SystemIndexSettings,
  membership: ReadonlyMap<number, number> = new Map(),
  historicalStates: ReadonlyMap<number, ProgramChainState> = new Map(),
) {
  const captured = captureProgramChainStates(input, settings)
  const rows = input.map(row => ({ ...row, programChainState: captured.get(row.id)! }))
  const states = new Map([...historicalStates, ...captured])
  const roots = new Map<number, number>()
  const rootOf = (id: number): number => {
    let root = id
    while (roots.has(root) && roots.get(root) !== root) root = roots.get(root)!
    let next = id
    while (roots.has(next) && roots.get(next) !== root) { const previous = roots.get(next)!; roots.set(next, root); next = previous }
    return root
  }
  // Only live canonical official continuations can join different roots.
  // A deleted number is never used to attach a new object.
  const byId = new Map(rows.map(row => [row.id, row]))
  const aliases = rows.some(row => isUnofficialJoint(row) && !!getPrimaryRejectedLnkResult(row))
    ? buildJointChainContinuations(rows, { systemIndexSettings: settings }) : []
  for (const continuation of aliases) {
    if (continuation.kind !== 'official-joint') continue
    const source = byId.get(continuation.sourceRowId), target = byId.get(continuation.targetRowIds[0])
    if (!source || !target || (source.programChainState.kind === 'coil') !== (target.programChainState.kind === 'coil')) continue
    const left = rootOf(source.programChainState.physicalRootId ?? source.id), right = rootOf(target.programChainState.physicalRootId ?? target.id)
    if (left !== right) roots.set(right, left)
  }
  const grouped = new Map<string, WeldRow[]>()
  for (const row of rows) {
    const rootId = rootOf(row.programChainState.physicalRootId ?? row.id)
    const physicalId = membership.get(row.id) ?? membership.get(rootId)
    const key = physicalId ? `p:${physicalId}` : `r:${rootId}`
    const group = grouped.get(key) ?? []; group.push(row); grouped.set(key, group)
  }
  // A new R/W may have no membership yet; resolve its root through the live
  // group's members, including a root reassigned during officiality rebuild.
  const physicalByRoot = new Map<number, Set<number>>()
  for (const row of rows) {
    const root = rootOf(row.programChainState.physicalRootId ?? row.id)
    const owners = physicalByRoot.get(root) ?? new Set<number>()
    for (const node of [row.id, root]) { const id = membership.get(node); if (id) owners.add(id) }
    physicalByRoot.set(root, owners)
  }
  for (const [key, group] of grouped) {
    if (!key.startsWith('r:')) continue
    const owners = physicalByRoot.get(Number(key.slice(2)))
    const physicalId = owners?.size === 1 ? [...owners][0] : null
    if (physicalId) { const target = grouped.get(`p:${physicalId}`) ?? []; for (const row of group) target.push(row); grouped.set(`p:${physicalId}`, target); grouped.delete(key) }
  }
  const statesByRoot = new Map<number, ProgramChainState[]>()
  for (const state of states.values()) {
    const root = state.physicalRootId ?? state.weldJointId, bucket = statesByRoot.get(root) ?? []
    bucket.push(state); statesByRoot.set(root, bucket)
  }
  const result: SchemePhysicalGroup[] = []
  for (const [key, group] of grouped) {
    const groupIds = new Set(group.map(row => row.id)), hasDescendant = new Set<number>()
    let issue: string | null = group.some(row => (physicalByRoot.get(rootOf(row.programChainState!.physicalRootId ?? row.id))?.size ?? 0) > 1)
      ? 'Физическая цепочка имеет несколько сохранённых привязок.' : null
    const rootIds = new Set(group.map(row => row.programChainState!.physicalRootId ?? row.id))
    const known = [...rootIds].flatMap(id => statesByRoot.get(id) ?? [])
    const members = new Set([...groupIds, ...known.map(state => state.weldJointId)])
    const active = group.filter(isActiveOfficialWeld)
    const expanded = new Set<number>()
    for (const row of active) {
      let state: ProgramChainState | undefined = row.programChainState
      const seen = new Set<number>([row.id])
      while (state?.kind === 'repair') {
        const sourceId = state.sourceRowId
        if (sourceId === null || !states.has(sourceId) || !byId.has(sourceId)) { issue = 'Не найден действующий предшественник в этой линии.'; break }
        if (seen.has(sourceId)) { issue = 'Обнаружен цикл в истории физического стыка.'; break }
        seen.add(sourceId)
        if (!groupIds.has(sourceId)) { issue = 'Предшественник относится к другой физической цепочке.'; break }
        hasDescendant.add(sourceId)
        if (expanded.has(sourceId)) break
        state = states.get(sourceId)
      }
      for (const id of seen) expanded.add(id)
    }
    const leaves = active.filter(row => !hasDescendant.has(row.id))
    if (leaves.length > 1) issue = 'Несколько актуальных официальных продолжений одного физического стыка.'
    const replaced = known.some(state => state.replacedByCoil)
    const representative = leaves.length === 1 ? leaves[0] : null
    let last = representative
    if (!last) {
      const historicalSources = new Set(group.flatMap(row => row.programChainState?.kind === 'repair' && row.programChainState.sourceRowId != null ? [row.programChainState.sourceRowId] : []))
      const historyLeaves = group.filter(row => !historicalSources.has(row.id))
      last = (historyLeaves.length ? historyLeaves : group).slice().sort((a, b) => compareJointChainRows(a, b, settings)).at(-1)!
    }
    const rootId = representative?.programChainState?.physicalRootId ?? group[0].programChainState!.physicalRootId ?? group[0].id
    const rootState = states.get(rootId)
    if (active.length && (!rootState || rootState.kind === 'repair' && rootState.physicalRootId == null)) issue = 'Не определена исходная физическая связь стыка.'
    result.push({ key, rootId, physicalId: key.startsWith('p:') ? Number(key.slice(2)) : null,
      rows: group, memberIds: [...members], representative, displayRow: last, label: String(last.joint ?? `#${last.id}`),
      welded: group.some(row => !!row.weldDate),
      inactive: replaced ? 'Исходный стык заменён катушкой.' : !active.length ? 'Нет актуального официального продолжения.' : null,
      issue,
    })
  }
  return result
}

export function createSchemeProjectionContext(contextRows: WeldRow[], settings: SystemIndexSettings) {
  return { final: buildFinalStatusRowsContext(contextRows), requirements: buildProgramRepairRequirements(contextRows, new Set(), settings) }
}

const detailText = (value: unknown) => typeof value === 'string' ? value.trim() || null : null
const detailNumber = (value: unknown) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(number) ? number : null
}

export function projectSchemeJoint(group: SchemePhysicalGroup, contextRows: WeldRow[], settings: SystemIndexSettings,
  prepared = createSchemeProjectionContext(contextRows, settings)): SchemeJoint {
  const detailRow = group.issue ? null : group.representative ?? group.displayRow
  const base: SchemeJoint = { key: group.key, rootId: group.rootId, physicalId: group.physicalId, rowId: group.issue ? null : (group.representative ?? group.displayRow).id,
    // Inspect the displayed record even when its chain is ambiguous. It must
    // not become an authoritative representative or acquire invented details.
    ...(group.issue ? { inspectionRowId: group.displayRow.id } : {}),
    label: group.label, welded: group.welded, color: 'waiting', reason: '', placedPage: null,
    ...(detailRow ? { weldInfo: {
      date: detailText(detailRow.weldDate), material1: detailText(detailRow.material1), material2: detailText(detailRow.material2),
      d1: detailNumber(detailRow.d1), d2: detailNumber(detailRow.d2),
      element1: detailText(detailRow.element1), element2: detailText(detailRow.element2), t1: detailNumber(detailRow.t1), t2: detailNumber(detailRow.t2),
      stamp1: detailText(detailRow.stamp1K), stamp1Fact: detailText(detailRow.stamp1KFact),
      stamp2: detailText(detailRow.stamp1Z), stamp2Fact: detailText(detailRow.stamp1ZFact),
    } } : {}) }
  if (group.issue) return { ...base, color: 'error', reason: group.issue }
  if (group.inactive) return { ...base, color: 'inactive', reason: group.inactive }
  if (!group.representative) return { ...base, color: 'error', reason: 'Не определён действующий стык.' }
  const row = group.representative
  const status = calculateFinalStatusInRows(row, contextRows, prepared.final)
  if (status === 'ошибка') return { ...base, color: 'error', reason: 'Противоречивые назначения или результаты контроля.' }
  if (getPrimaryRejectedLnkResult(row) || status.startsWith('не годен') || status === 'ожидает ремонт') return { ...base, color: 'rejected', reason: 'Брак — ожидает исправление.' }
  const isRepair = row.programChainState?.kind === 'repair' || group.rows.some(other => other.id !== row.id && !!getPrimaryRejectedLnkResult(other))
  if (!row.weldDate) return { ...base, color: isRepair ? 'rejected' : 'planned', reason: isRepair ? 'Ремонт ещё не сварен.' : 'Дата сварки не указана.' }
  const requirements = prepared.requirements.get(row.id) ?? []
  if (requirements.some(requirement => !satisfiesProgramRepairRequirement(row, requirement))) return { ...base, color: 'error', reason: 'Не восстановлены обязательные назначения НК ремонта.' }
  if (status === 'годен') return { ...base, color: 'good', reason: 'Итоговое «Годен» по всем обязательным этапам.' }
  const pendingNk = CONTROL_RESULT_PAIRS.some(({ enabledKey, resultKey }) => isControlEnabledValue(row[enabledKey]) && normalizeResultStatus(row[resultKey]) !== 'годен') || !!getPreHeatTreatmentPendingFinalStatus(row)
  if (isRepair && pendingNk) return { ...base, color: 'repair', reason: 'Ремонт сварен, ожидается НК.' }
  return { ...base, reason: `Ожидаются обязательные этапы: ${status}.` }
}
