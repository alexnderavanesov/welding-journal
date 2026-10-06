import { and, eq, inArray } from 'drizzle-orm'
import { EARLY_COIL_DECISION_KIND } from '@/lib/early-coil-decision'
import { dispatcherAcceptedWarnings } from '@/db/schema'
import type { WeldInput } from '@/lib/weld-fields'
import { programApprovalKey } from '@/lib/program-control-approval'
import { buildTextArrayMatch, buildNumberArrayMatch } from './weld-request-utils'
import type { ProgramApproval } from '@/lib/program-approval-actions'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { acceptedWarningVersionSql } from './accepted-warning-objects'

export async function loadProgramApprovals(tx: Pick<SystemDocumentSequenceTransaction, 'select'>, ids: number[], options: { includeEarlyCoil?: boolean } = {}): Promise<ProgramApproval[]> {
  if (!ids.length) return []
  const records = await tx.select({ key: dispatcherAcceptedWarnings.key, rowId: dispatcherAcceptedWarnings.weldJointId, version: acceptedWarningVersionSql })
    .from(dispatcherAcceptedWarnings).where(and(options.includeEarlyCoil ? inArray(dispatcherAcceptedWarnings.kind, ['line-program-control', EARLY_COIL_DECISION_KIND]) : eq(dispatcherAcceptedWarnings.kind, 'line-program-control'), buildNumberArrayMatch(dispatcherAcceptedWarnings.weldJointId, ids)))
  return records.map(item => ({ key: item.key, rowId: item.rowId!, version: item.version }))
}

/** Called after a validated mutation, in its transaction. Quota/name/history edits do nothing. */
export async function deleteChangedProgramApprovals(tx: SystemDocumentSequenceTransaction, rows: readonly WeldInput[], previousRows: ReadonlyMap<number, WeldInput>) {
  const keys: string[] = []
  for (const row of rows) {
    const id = Number(row.id), previous = previousRows.get(id)
    if (!previous) continue
    for (const kind of ['common', 'pvk'] as const) for (const duplicate of [false, true]) {
      const before = programApprovalKey({ ...previous, id }, kind, duplicate)
      if (before !== programApprovalKey({ ...row, id }, kind, duplicate)) keys.push(before)
    }
  }
  if (keys.length) await tx.delete(dispatcherAcceptedWarnings).where(and(
    eq(dispatcherAcceptedWarnings.kind, 'line-program-control'), buildTextArrayMatch(dispatcherAcceptedWarnings.key, keys),
  ))
}
