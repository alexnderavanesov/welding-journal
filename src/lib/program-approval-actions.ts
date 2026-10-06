import type { WeldRow } from './dispatcher-types'
import { calculateLineProgram } from './line-program-calculation'
import type { LineProgramRecord } from './line-program'
import { programExcessEntries } from './line-program-workspace'
import { parseStoredProgramApproval, programApprovalKey } from './program-control-approval'
import { normalizeControlAvailabilityStorageText } from './control-availability-values'
import type { WeldRowVersionTarget } from './weld-row-version'

export type ProgramApproval = { key: string; rowId: number; version: string }
export type ProgramApprovalOption = { key: string; rowId: number; duplicate: boolean; kind: 'common' | 'pvk' }

/** Saved approvals remain revocable when the quota changes and excess disappears. */
export function getProgramApprovalOptions(rows: WeldRow[], line: Pick<LineProgramRecord, 'id' | 'weldControlPercent' | 'pvkControlPercent'>, approvals: readonly ProgramApproval[]) {
  const byId = new Map(rows.map(row => [row.id, row]))
  const revoke: ProgramApprovalOption[] = []
  for (const approval of approvals) {
    const parsed = parseStoredProgramApproval(approval.key), row = byId.get(approval.rowId)
    if (parsed && row && parsed.rowId === row.id && programApprovalKey(row, parsed.kind, parsed.duplicate) === approval.key) revoke.push(parsed)
  }
  const accepted = new Set(revoke.map(item => item.key))
  const entries = line.weldControlPercent == null || line.pvkControlPercent == null ? [] : programExcessEntries(line.id, rows, calculateLineProgram(rows, line.weldControlPercent, line.pvkControlPercent, undefined, accepted))
  // Explicit RK + UZK approval is independent of quota, failures and physical counting.
  const pairs: ProgramApprovalOption[] = rows.filter(row => [row.hasRk, row.hasUzk].every(value =>
    ['да', 'дополнительный'].includes(normalizeControlAvailabilityStorageText(value) ?? '')))
    .map(row => ({ key: programApprovalKey(row, 'common', true), rowId: row.id, duplicate: true, kind: 'common' }))
  const approve = [...new Map< string, ProgramApprovalOption>([...entries, ...pairs].filter(entry => !accepted.has(entry.key)).map(entry => [entry.key, entry])).values()]
  return { approve, revoke }
}

export function programApprovalVersion(approvals: readonly ProgramApproval[]) {
  return JSON.stringify(approvals.map(item => [item.key, item.version]).sort((a, b) => a[0].localeCompare(b[0])))
}

export function getProgramApprovalTargets(targets: readonly WeldRowVersionTarget[], approvals: readonly ProgramApproval[]) {
  const selected = new Set(targets.map(target => target.id)), byId = new Map<number, ProgramApproval[]>()
  for (const approval of approvals) {
    const id = approval.rowId
    if (!selected.has(id)) continue
    const group = byId.get(id) ?? []
    group.push(approval); byId.set(id, group)
  }
  return targets.map(target => ({ ...target, approvalVersion: programApprovalVersion(byId.get(target.id) ?? []) }))
}
