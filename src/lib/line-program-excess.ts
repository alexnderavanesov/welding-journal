import { PROGRAM_DEMAND_LABELS } from '@/lib/line-program-labels'
import type { WeldRow } from './dispatcher-types'
import { getLineProgramRowDemand, type LineProgramStampCalculation } from './line-program-calculation'
import { applyProgramPatch, programAssignment, programExcessEntries, type ProgramExcessEntry, type ProgramMethod } from './line-program-workspace'
import { getProgramAssignmentError } from './line-program-assignment-validation'
import { buildProgramRepairRequirements } from './line-program-repair-requirements'
import { buildSupportProgramContext, getSupportChainMethodState } from './support-program-calculation'

export const programExcessIdentity = (entry: ProgramExcessEntry) => `${entry.rowId}:${entry.kind}:${entry.duplicate}:${entry.method ?? ''}`

/** A shared joint is one issue, not one extra physical control per welder. */
export function partitionProgramExcess(entries: readonly ProgramExcessEntry[], _accepted: ReadonlySet<string>) {
  const buckets = new Map<string, ProgramExcessEntry[]>()
  for (const entry of entries) {
    const id = programExcessIdentity(entry), bucket = buckets.get(id) ?? []
    bucket.push(entry); buckets.set(id, bucket)
  }
  const pending: ProgramExcessEntry[] = [], approved: ProgramExcessEntry[] = []
  for (const bucket of buckets.values()) {
    // Legacy approval records are historical only. Additional is the sole
    // explicit decision; it is already excluded by the shared calculation.
    pending.push(...bucket)
  }
  return { pending, approved }
}

export function projectProgramExcess(lineId: number, rows: readonly WeldRow[], groups: readonly LineProgramStampCalculation[], accepted: ReadonlySet<string>) {
  const { pending } = partitionProgramExcess(programExcessEntries(lineId, rows, groups), accepted)
  const pendingKeys = new Set(pending.map(entry => `${entry.rowId}:${entry.kind}:${entry.duplicate}`))
  return groups.map(group => ({ ...group, ...Object.fromEntries((['common', 'pvk'] as const).map(kind => [kind, {
    ...group[kind],
    excessRowIds: group[kind].excessRowIds.filter(rowId => pendingKeys.has(`${rowId}:${kind}:false`)),
    duplicateAssignmentRowIds: group[kind].duplicateAssignmentRowIds.filter(rowId => pendingKeys.has(`${rowId}:${kind}:true`)),
    excessAssignments: group[kind].excessAssignments?.filter(entry => pendingKeys.has(`${entry.rowId}:${kind}:${entry.duplicate}`)),
  }])) })) as LineProgramStampCalculation[]
}

export type ProgramRemovalHints = Map<number, Map<ProgramMethod, string>>

/** Suggestions only. A deterministic subset can be removed together without reducing quota coverage.
 * Factual results/history, inherited assignments and necessary layered PVK are never suggested.
 * Authoritative save validation still runs after any manual change.
 */
export function getProgramRemovalHints(lineId: number, rows: readonly WeldRow[], groups: readonly LineProgramStampCalculation[], accepted: ReadonlySet<string>): ProgramRemovalHints {
  if (groups.length && groups.every(group => group.support)) return getSupportRemovalHints(lineId, rows, groups)
  const entries = programExcessEntries(lineId, rows, groups)
  const pendingAssignments = new Set(partitionProgramExcess(entries, accepted).pending.map(entry => `${entry.rowId}:${entry.method}`))
  const byId = new Map(rows.map(row => [row.id, row]))
  const hints: ProgramRemovalHints = new Map()
  for (const kind of ['common', 'pvk'] as const) {
    const memberships = new Map<number, number[]>()
    const remaining = groups.map(group => group[kind].coveredRowIds.length)
    groups.forEach((group, index) => {
      for (const id of group[kind].coveredRowIds) {
        const owners = memberships.get(id) ?? []
        owners.push(index); memberships.set(id, owners)
      }
    })
    // Search ALL covered joints: a protected surplus row must not hide a removable alternative.
    for (const id of [...memberships.keys()].sort((a, b) => b - a)) {
      let row = byId.get(id)!
      const state = getLineProgramRowDemand(row, kind)
      if (!state.assigned || state.additional) continue
      const owners = memberships.get(id)!
      for (const method of kind === 'pvk' ? ['ПВК'] as const : ['УЗК', 'РК'] as const) {
        if (!pendingAssignments.has(`${id}:${method}`)) continue
        if (programAssignment(row, method) !== 'да' || getProgramAssignmentError(row, { [method]: '' }, true)) continue
        const next = applyProgramPatch(row, { [method]: '' })
        const losesCoverage = !getLineProgramRowDemand(next, kind).covered
        if (losesCoverage && !owners.every(index => remaining[index] > groups[index][kind].required)) continue
        // Budgets are reduced together, not independently for every suggested alternative.
        if (losesCoverage) for (const index of owners) remaining[index]--
        const methods = hints.get(id) ?? new Map<ProgramMethod, string>()
        methods.set(method, losesCoverage
          ? 'Можно снять «Да»: сверх нормы всех клейм этого стыка, выполненной работы по методу нет; позиция имеющейся заявки удалится при сохранении. Выделенные назначения можно снять вместе; сохранение повторно проверит данные.'
          : `Можно снять «Да»: другой метод закрывает ${PROGRAM_DEMAND_LABELS.common}, выполненной работы по снимаемому методу нет; позиция имеющейся заявки удалится при сохранении. Сохранение повторно проверит данные.`)
        hints.set(id, methods); row = next
      }
      byId.set(id, row)
    }
  }
  const repairRequirements = buildProgramRepairRequirements(rows, accepted)
  for (const entry of entries) {
    const row = byId.get(entry.rowId)
    if (!row || !entry.method || !repairRequirements.has(row.id)) continue
    const contextual = { ...row, programRepairRequirements: repairRequirements.get(row.id) }
    if (programAssignment(row, entry.method) !== 'да' || getProgramAssignmentError(contextual, { [entry.method]: '' }, true)) continue
    const methods = hints.get(row.id) ?? new Map<ProgramMethod, string>()
    methods.set(entry.method, 'Обычное назначение ремонта не участвует в процентном зачёте и не обязательно по истории цепочки. По этому методу нет защищённых результатов; позиция имеющейся заявки удалится при сохранении; можно снять вместе с другими выделенными назначениями.')
    hints.set(row.id, methods)
  }
  return hints
}

/** Counts assignments, not physical joints or duplicated welder memberships. */
export function countProgramRemovalHints(hints: ProgramRemovalHints, rowIds: Iterable<number> = hints.keys()) {
  let count = 0
  for (const id of rowIds) count += hints.get(id)?.size ?? 0
  return count
}

/** Support quotas count roots; removals target concrete assignments on members. */
function getSupportRemovalHints(lineId: number, rows: readonly WeldRow[], groups: readonly LineProgramStampCalculation[]): ProgramRemovalHints {
  const context = buildSupportProgramContext(rows)
  const drafts = new Map<number, WeldRow>(context.rows.map(row => [row.id, row]))
  const requirements = buildProgramRepairRequirements(context.rows, new Set())
  const rootsByMember = new Map([...context.members].flatMap(([root, members]) => members.map(row => [row.id, root] as const)))
  const hints: ProgramRemovalHints = new Map()
  const entries = programExcessEntries(lineId, rows, groups)
  for (const kind of ['common', 'pvk'] as const) {
    const remaining = groups.map(group => group[kind].coveredRowIds.length)
    const pending = [...new Set(entries.filter(entry => entry.kind === kind).map(entry => entry.rowId))].sort((a, b) => b - a)
    const method = kind === 'common' ? 'УЗК' : 'ПВК'
    for (const id of pending) {
      const row = drafts.get(id), root = rootsByMember.get(id)
      if (!row || root === undefined || programAssignment(row, method) !== 'да') continue
      const contextual = { ...row, programRepairRequirements: row.programRepairRequirements ?? requirements.get(id) }
      if (getProgramAssignmentError(contextual, { [method]: '' }, true)) continue
      const owners = groups.flatMap((group, index) => group[kind].coveredRowIds.includes(root) ? [index] : [])
      if (!owners.length) continue
      const next = applyProgramPatch(contextual, { [method]: '' })
      const members = (context.members.get(root) ?? []).map(member => member.id === id ? next : drafts.get(member.id)!)
      const losesCoverage = !getSupportChainMethodState(members, kind).covered
      if (losesCoverage && !owners.every(index => remaining[index] > (groups[index][kind].actionableRequired ?? groups[index][kind].required))) continue
      if (losesCoverage) for (const index of owners) remaining[index]--
      drafts.set(id, next)
      const methods = hints.get(id) ?? new Map<ProgramMethod, string>()
      methods.set(method, losesCoverage
        ? 'Можно снять «Да»: сверх достижимой потребности опор. Выделенные назначения можно снять вместе; позиция имеющейся заявки удалится при сохранении.'
        : 'Можно снять «Да»: зачёт физической опоры сохранён другим назначением или выполненным контролем её цепочки. Выделенные назначения можно снять вместе; позиция имеющейся заявки удалится при сохранении.')
      hints.set(id, methods)
    }
  }
  return hints
}
