import type { RepeatedJointCheckTask, WeldRow } from './dispatcher-types'
import type { ProgramChainState } from './line-program-chain-state'
import { buildLineProgramTopology, programJointIdentity } from './line-program-topology'
import { isActiveOfficialWeld } from './control-assignment-eligibility'
import { calculateFinalStatus } from './weld-status'
import { buildJointChainConsistencyCheckTasks } from './repeated-joint-consistency-tasks'
import { getOfficialRejectedJointChainRows, getPrimaryRejectedLnkResult } from './repeated-joint-task-helpers'
import { buildProgramRepairTasks } from './line-program-repair-requirements'
import { normalizeJointChainPart, parseJointChainName, parseRepeatedJointName } from './joint-chain'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'
import { buildChainActualityCheckTasks } from './chain-actuality-check'

export function buildProgramIntegrityTasks(rows: readonly WeldRow[], settings: SystemIndexSettings = loadSystemIndexSettings()): RepeatedJointCheckTask[] {
  const topology = buildLineProgramTopology(rows, false, settings)
  const messages = new Map<number, string[]>()
  for (const issue of topology.issues) {
    const values = messages.get(issue.rowId) ?? []
    values.push(issue.message); messages.set(issue.rowId, values)
  }
  return topology.rows.flatMap(row => {
    const details = messages.get(row.id)
    return details ? [{ kind: 'check' as const, key: `program-integrity:${row.id}`, row, sourceRow: row,
      sourceJoint: String(row.joint ?? ''), targetJoint: '', baseJoint: parseRepeatedJointName(String(row.joint ?? ''), settings).base,
      suffix: 'R' as const, systemWarningCode: 'СП-04' as const,
      ...(row.programChainState?.replacedByCoil ? { coilRestorationRootId: row.id } : {}),
      reason: 'проверить физическую цепочку', details: details.join(' ') }] : []
  })
}

/** Input is the ID-connected graph, including deleted states, across all lines.
 * Names alone never authorize reversal of a recorded physical replacement. */
export function getCoilRestorationBlockReason(root: WeldRow, live: readonly WeldRow[], states: readonly ProgramChainState[],
  approved: ReadonlySet<string>, settings: SystemIndexSettings, lineRows: readonly WeldRow[] = live) {
  const rootState = states.find(state => state.weldJointId === root.id)
  if (!rootState?.replacedByCoil || rootState.kind === 'repair') return 'Исходное соединение не отмечено как заменённое катушкой.'
  if (!isActiveOfficialWeld(root)) return 'Сначала верните официальность и актуальность исходного соединения.'
  const replacementIds = new Set(rootState.replacementCoilIds)
  const sides = new Set(states.filter(state => replacementIds.has(state.weldJointId) && state.kind === 'coil' && state.coilParentId === root.id).map(state => state.coilSide))
  if (!sides.has(1) || !sides.has(2)) return 'Недостаточно сохранённых связей обеих сторон катушки. Подтвердить отсутствие продолжений нельзя; требуется восстановление достоверной истории.'
  const byId = new Map(states.map(state => [state.weldJointId, state]))
  const branch = live.map(row => ({ ...row, finalStatus: calculateFinalStatus(row), programChainState: byId.get(row.id) }))
  const branchIds = new Set(branch.map(row => row.id))
  const rootName = parseJointChainName(String(root.joint ?? ''), settings)
  if (lineRows.some(row => {
    if (branchIds.has(row.id)) return false
    const name = parseJointChainName(String(row.joint ?? ''), settings)
    return normalizeJointChainPart(name.base) === normalizeJointChainPart(rootName.base) && name.segments.length >= rootName.segments.length &&
      rootName.segments.every((part, index) => part.suffix === name.segments[index].suffix && part.index === name.segments[index].index)
  })) return 'В линии есть одноимённые или несвязанные продолжения этой ветки. Сначала исправьте сохранённые связи цепочки.'
  if (branch.some(row => row.id !== root.id && (row.programChainState?.kind !== 'repair' || row.programChainState.physicalRootId !== root.id))) {
    return 'Сохранились стороны катушки или их продолжения, в том числе перенесённые или неофициальные. Сначала исправьте историю этих записей.'
  }
  if (branch.some(row => programJointIdentity(row, '') !== programJointIdentity(root, ''))) return 'Часть цепочки перенесена на другую линию. Сначала восстановите целостность цепочки.'
  if (buildChainActualityCheckTasks(branch, settings).length) return 'Сначала согласуйте актуальность исходного соединения и всей его R/W-истории по ДЗ-13. Обе команды доступны в «Картине стыка».'
  const branchById = new Map(branch.map(row => [row.id, row]))
  // Keep every ID-connected row even after a rename moves it out of the name
  // group. Names may add ambiguity checks, never remove saved chain evidence.
  const completeRows = [...new Map([
    ...lineRows.filter(row => normalizeJointChainPart(parseJointChainName(String(row.joint ?? ''), settings).base) === normalizeJointChainPart(rootName.base)),
    ...branch,
  ].map(row => [row.id, row])).values()]
  if (buildLineProgramTopology(completeRows, false, settings).issues.some(issue => branchIds.has(issue.rowId) && !(issue.rowId === root.id && issue.code === 'missing-replacement'))) return 'Сначала исправьте отсутствующие или противоречивые связи цепочки.'
  const active = branch.filter(isActiveOfficialWeld)
  if (active.some(row => !String(row.weldDate ?? '').trim())) return 'Сначала заполните даты сварки действующих шагов цепочки.'
  const good = active.filter(row => calculateFinalStatus(row) === 'годен')
  const ancestors = new Set<number>()
  for (const row of active) {
    let sourceId = row.programChainState?.sourceRowId
    while (sourceId != null && branchById.has(sourceId) && !ancestors.has(sourceId)) {
      ancestors.add(sourceId)
      sourceId = branchById.get(sourceId)?.programChainState?.sourceRowId
    }
  }
  const leaves = active.filter(row => !ancestors.has(row.id))
  if (good.length !== 1 || leaves.length !== 1 || leaves[0].id !== good[0].id || active.some(row => row.id !== good[0].id && !getPrimaryRejectedLnkResult(row))) {
    return 'Нужен единственный официальный актуальный годный финал без незавершённых шагов или продолжений после него.'
  }
  if (new Set(active.map(row => programJointIdentity(row))).size !== active.length) return 'В цепочке повторяются официальные номера. Сначала исправьте дубли.'
  const checks = buildJointChainConsistencyCheckTasks(completeRows, { getPrimaryRejectedLnkResult, getOfficialRejectedJointChainRows }, settings).filter(task => branchIds.has(task.row.id))
  if (checks.length) return `Сначала исправьте цепочку: ${checks[0].details ?? checks[0].reason}.`
  if (buildProgramRepairTasks(branch, approved, settings).length) return 'Сначала назначьте все обязательные методы НК ремонта и завершите контроль.'
  return null
}
