import { createServerFn } from '@tanstack/react-start'
import { and, eq } from 'drizzle-orm'
import { requireDb } from '@/db'
import { dispatcherAcceptedWarnings, linePrograms } from '@/db/schema'
import { getProgramApprovalOptions, programApprovalVersion, type ProgramApproval } from '@/lib/program-approval-actions'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { assertSecurityScope } from './security-functions'
import { buildTextArrayMatch } from './weld-request-utils'
import { loadProgramApprovals } from './program-approval-lifecycle'
import { lockAcceptedWarningWrites } from './accepted-warning-objects'
import { lockWeldLineMemberships } from './weld-line-membership-lock'
import { assertExpectedInteractiveWeldVersions, lockInteractiveWeldRows } from './weld-row-version'
import { loadLineProgramOverviews, loadLineProgramRows, toLineProgramRecord } from './line-program'
import { getDispatcherDirtyScopes, markDispatcherTaskIndexDirty } from './dispatcher-task-index-dirty'

export type ProgramApprovalRequest = {
  lineId: number; lineVersion: string; action: 'approve' | 'revoke'; confirmed: boolean
  targets: (WeldRowVersionTarget & { approvalVersion: string })[]; keys: string[]
}
export const changeLineProgramApprovals = createServerFn({ method: 'POST' })
  .validator((data: ProgramApprovalRequest) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    return requireDb().transaction(tx => changeProgramApprovalsInTransaction(tx, data))
  })

/** Decision-only mutation: never writes weld rows or runs document workflows. */
export async function changeProgramApprovalsInTransaction(tx: SystemDocumentSequenceTransaction, data: ProgramApprovalRequest) {
  if (!data.confirmed || !['approve', 'revoke'].includes(data.action)) throw new Error('Подтвердите действие с согласованиями.')
  if (!Array.isArray(data.targets) || !data.targets.length || data.targets.length > 1000 || new Set(data.targets.map(item => item.id)).size !== data.targets.length || data.targets.some(item => !Number.isSafeInteger(item.id) || item.id <= 0 || !item.version || typeof item.approvalVersion !== 'string')) throw new Error('Выберите от 1 до 1000 стыков с актуальными версиями.')
  if (!Array.isArray(data.keys) || !data.keys.length || data.keys.length > 4000 || new Set(data.keys).size !== data.keys.length || data.keys.some(key => typeof key !== 'string' || key.length > 500)) throw new Error('Некорректный список согласований.')
  await lockAcceptedWarningWrites(tx)
  const [snapshot] = await tx.select().from(linePrograms).where(eq(linePrograms.id, data.lineId)).limit(1)
  if (!snapshot) throw new Error('Линия больше не существует.')
  await lockWeldLineMemberships(tx, [snapshot])
  const [line] = await tx.select().from(linePrograms).where(eq(linePrograms.id, data.lineId)).for('update')
  if (!line || line.updatedAt.toISOString() !== data.lineVersion) throw new Error('Программа линии изменилась. Обновите данные.')
  const ids = data.targets.map(item => item.id), selected = await lockInteractiveWeldRows(tx, ids)
  assertExpectedInteractiveWeldVersions(ids, data.targets, selected)
  if (selected.some(row => row.lineProgramId !== line.id)) throw new Error('Стык перенесён на другую линию. Обновите данные.')
  const rows = await loadLineProgramRows(tx, line)
  // Other joints' approved combinations occupy quota too. Selection limits
  // which decisions may change, not the context used to identify surplus.
  const approvals = await loadProgramApprovals(tx, rows.map(row => row.id))
  const approvalsById = new Map<number, ProgramApproval[]>()
  for (const item of approvals) { const group = approvalsById.get(item.rowId) ?? []; group.push(item); approvalsById.set(item.rowId, group) }
  if (data.targets.some(target => target.approvalVersion !== programApprovalVersion(approvalsById.get(target.id) ?? []))) throw new Error('Согласования изменились в другом окне. Обновите данные; ничего не изменено.')
  const options = getProgramApprovalOptions(rows, toLineProgramRecord(line), approvals)
  const selectedIds = new Set(ids), candidates = new Map(options[data.action].filter(item => selectedIds.has(item.rowId)).map(item => [item.key, item]))
  const candidateIds = new Set(data.keys.map(key => candidates.get(key)?.rowId))
  if (data.keys.some(key => !candidates.has(key)) || ids.some(id => !candidateIds.has(id))) throw new Error('Состав контроля или согласований изменился. Обновите данные; ничего не изменено.')
  if (data.action === 'approve') await tx.insert(dispatcherAcceptedWarnings).values(data.keys.map(key => {
    const option = candidates.get(key)!
    return { key, weldJointId: option.rowId, kind: 'line-program-control', title: option.duplicate ? 'Согласовано сочетание методов' : 'Согласовано превышение', context: option.kind === 'pvk' ? 'ПВК' : 'РК - УЗК' }
  })).onConflictDoNothing()
  else await tx.delete(dispatcherAcceptedWarnings).where(and(eq(dispatcherAcceptedWarnings.kind, 'line-program-control'), buildTextArrayMatch(dispatcherAcceptedWarnings.key, data.keys)))
  await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes([line], new Map()) })
  return { changed: ids.length, lineSummary: (await loadLineProgramOverviews(tx, [toLineProgramRecord(line)]))[0] }
}
