import { PROGRAM_DEMAND_LABELS } from '@/lib/line-program-labels'
import type { WeldRow } from './dispatcher-types'
import { getLineProgramRowDemand, type LineProgramStampCalculation } from './line-program-calculation'
import { applyProgramPatch, programAssignment, programExcessEntries, type ProgramExcessEntry, type ProgramMethod } from './line-program-workspace'
import { getProgramAssignmentError } from './line-program-assignment-validation'
import { programApprovalKey } from './program-control-approval'
import { buildProgramRepairRequirements } from './line-program-repair-requirements'

export const programExcessIdentity = (entry: ProgramExcessEntry) => `${entry.rowId}:${entry.kind}:${entry.duplicate}:${entry.method ?? ''}`

/** A shared joint is one issue, not one extra physical control per welder. */
export function partitionProgramExcess(entries: readonly ProgramExcessEntry[], accepted: ReadonlySet<string>) {
  const buckets = new Map<string, ProgramExcessEntry[]>()
  for (const entry of entries) {
    const id = programExcessIdentity(entry), bucket = buckets.get(id) ?? []
    bucket.push(entry); buckets.set(id, bucket)
  }
  const pending: ProgramExcessEntry[] = [], approved: ProgramExcessEntry[] = []
  for (const bucket of buckets.values()) {
    const agreed = bucket.every(entry => accepted.has(entry.key))
    if (agreed) approved.push(...bucket)
    // Explicit approval of interchangeable methods removes that issue from "Excess".
    if (!agreed || !bucket[0].duplicate) pending.push(...bucket)
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
 * Factual results/history, approved interchangeable patterns and necessary layered PVK are never suggested.
 * Authoritative save validation still runs after any manual change.
 */
export function getProgramRemovalHints(lineId: number, rows: readonly WeldRow[], groups: readonly LineProgramStampCalculation[], accepted: ReadonlySet<string>): ProgramRemovalHints {
  const entries = programExcessEntries(lineId, rows, groups)
  const pendingAssignments = new Set(partitionProgramExcess(entries, accepted).pending.map(entry => `${entry.rowId}:${entry.method}`))
  // Agreed interchangeable methods are protected, ordinary over-quota approval is not.
  const approvedKinds = new Set(entries.filter(entry => entry.duplicate && accepted.has(entry.key)).map(entry => `${entry.rowId}:${entry.kind}`))
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
      if (approvedKinds.has(`${id}:${kind}`)) continue
      let row = byId.get(id)!
      if (accepted.has(programApprovalKey(row, kind, true))) continue
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
          ? 'Можно снять «Да»: сверх нормы всех клейм этого стыка, заявок и результатов по методу нет. Выделенные назначения можно снять вместе; сохранение повторно проверит данные.'
          : `Можно снять «Да»: другой метод закрывает ${PROGRAM_DEMAND_LABELS.common}, заявок и результатов по снимаемому методу нет. Сохранение повторно проверит данные.`)
        hints.set(id, methods); row = next
      }
      byId.set(id, row)
    }
  }
  const repairRequirements = buildProgramRepairRequirements(rows, accepted)
  for (const entry of entries) {
    const row = byId.get(entry.rowId)
    if (!row || !entry.method || !repairRequirements.has(row.id) || accepted.has(programApprovalKey(row, entry.kind, true))) continue
    const contextual = { ...row, programRepairRequirements: repairRequirements.get(row.id) }
    if (programAssignment(row, entry.method) !== 'да' || getProgramAssignmentError(contextual, { [entry.method]: '' }, true)) continue
    const methods = hints.get(row.id) ?? new Map<ProgramMethod, string>()
    methods.set(entry.method, 'Обычное назначение ремонта не участвует в процентном зачёте и не обязательно по истории цепочки. По этому методу нет защищённых заявок или результатов; можно снять вместе с другими выделенными назначениями.')
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
