import type { RepeatedJointRenameChange, WeldRow } from './dispatcher-types'
import { getJointChainConsistencyKey } from './joint-chain-keys'
import { normalizeJointChainPart } from './joint-chain'
import { isUnofficialJoint } from './joint-display'
import { findFirstLnkRepairRuleIssue } from './lnk-result-rules'
import { getExpectedRepeatedJointName, getPrimaryRejectedLnkResult } from './repeated-joint-task-helpers'
import type { SystemIndexSettings } from './system-index-settings'

// Only for an explicitly previewed restoration. Walk the OLD official sequence
// before changing any names, then replay its facts after the restored rejection.
// Never infer order from IDs, array position or dates, and never copy results.
export function buildOfficialityRestorationRenames(
  rows: readonly WeldRow[],
  restoredRows: readonly WeldRow[],
  settings: SystemIndexSettings,
): RepeatedJointRenameChange[] {
  const groups = new Map<string, WeldRow[]>()
  const key = (row: WeldRow, joint: unknown = row.joint) =>
    JSON.stringify([getJointChainConsistencyKey(row, settings) ?? `row:${row.id}`, normalizeJointChainPart(joint)])
  for (const row of rows) {
    const groupKey = key(row)
    const group = groups.get(groupKey)
    if (group) group.push(row)
    else groups.set(groupKey, [row])
  }
  const changes: RepeatedJointRenameChange[] = []
  const projectedRows: WeldRow[] = []
  for (const restored of restoredRows) {
    let group = (groups.get(key(restored)) ?? []).filter(row => !isUnofficialJoint(row))
    if (group.length === 0) continue
    let previous: WeldRow = { ...restored, officiality: null }
    projectedRows.push(previous)
    const visited = new Set<number>([restored.id])
    while (group.length > 0) {
      const officials = group.filter(row => !isUnofficialJoint(row))
      if (officials.length !== 1) {
        throw new Error('Продолжение цепочки неоднозначно: нужно определить единственный официальный стык каждого шага. Ничего не сохранено.')
      }
      const current = officials[0]!
      const rejection = getPrimaryRejectedLnkResult(previous)
      if (!rejection) {
        throw new Error('Для обратной перестройки нужен негодный результат восстановленного источника. Без него нет основания для продолжения. Ничего не сохранено.')
      }
      const targetJoint = getExpectedRepeatedJointName(previous, String(previous.joint), rejection.result, settings)
      for (const member of group) {
        if (visited.has(member.id)) throw new Error('В цепочке обнаружен цикл. Обратная перестройка остановлена.')
        visited.add(member.id)
        changes.push({ rowId: member.id, currentJoint: String(member.joint), targetJoint })
        projectedRows.push({ ...member, joint: targetJoint })
      }
      previous = { ...current, joint: targetJoint }
      const currentRejection = getPrimaryRejectedLnkResult(current)
      if (!currentRejection) break
      const oldNextName = getExpectedRepeatedJointName(current, String(current.joint), currentRejection.result, settings)
      group = groups.get(key(current, oldNextName)) ?? []
    }
  }
  // Restoring an earlier repair can move a later "ремонт" beyond R2. Reject
  // that plan; converting its following row to W must not hide the violation.
  const issue = findFirstLnkRepairRuleIssue(projectedRows, undefined, settings)
  if (issue) throw new Error(`Обратная перестройка невозможна: ${issue} Ничего не сохранено.`)
  return changes
}
