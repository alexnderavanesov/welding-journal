import { createServerFn } from '@tanstack/react-start'
import { count, eq, or } from 'drizzle-orm'
import { requireDb } from '@/db'
import { dispatcherAcceptedWarnings, linePrograms, pstoChainExceptions, weldJoints } from '@/db/schema'
import { normalizeLineProgramIdentity } from '@/lib/line-program'
import { requirePermission } from './access-context'
import { lineProgramWeldWhere } from './line-program-rename'
import { lockWeldLineMemberships } from './weld-line-membership-lock'
import { getDispatcherDirtyScopes, markDispatcherTaskIndexDirty } from './dispatcher-task-index-dirty'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

function validate(input: { id: number; version: string }) {
  if (!Number.isSafeInteger(input?.id) || input.id < 1 || typeof input.version !== 'string' || !Number.isFinite(Date.parse(input.version))) throw new Error('Обновите программу линии и повторите действие.')
  return { id: input.id, version: input.version }
}
async function inspect(tx: Pick<SystemDocumentSequenceTransaction, 'select'>, line: typeof linePrograms.$inferSelect) {
  const [{ value: journalRows }] = await tx.select({ value: count() }).from(weldJoints).where(or(eq(weldJoints.lineProgramId, line.id), lineProgramWeldWhere(normalizeLineProgramIdentity(line))))
  const [{ value: historyRecords }] = await tx.select({ value: count() }).from(pstoChainExceptions).where(eq(pstoChainExceptions.lineProgramId, line.id))
  const reason = journalRows ? `В журнале есть записи этой линии: ${journalRows}. Учитываются также неофициальные и неактуальные стыки.`
    : historyRecords ? 'У линии есть история решений ПСТО. Удаление программы нарушит её связи.' : null
  return { journalRows, historyRecords, reason }
}
export const previewLineProgramDeletion = createServerFn({ method: 'POST' }).validator(validate).handler(async ({ data }) => {
  await requirePermission('lines.delete')
  return requireDb().transaction(async tx => {
    const [line] = await tx.select().from(linePrograms).where(eq(linePrograms.id, data.id))
    if (!line || line.updatedAt.toISOString() !== data.version) throw new Error('Программа линии изменена. Обновите список линий.')
    return inspect(tx, line)
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
})

export async function deleteEmptyLineProgram(tx: SystemDocumentSequenceTransaction, data: { id: number; version: string }) {
  validate(data)
  const [snapshot] = await tx.select().from(linePrograms).where(eq(linePrograms.id, data.id))
  if (!snapshot) throw new Error('Программа линии уже удалена. Обновите список линий.')
  await lockWeldLineMemberships(tx, [snapshot])
  const [line] = await tx.select().from(linePrograms).where(eq(linePrograms.id, data.id)).for('update')
  if (!line || line.updatedAt.toISOString() !== data.version || line.updatedAt.getTime() !== snapshot.updatedAt.getTime()) throw new Error('Программа линии изменена. Обновите список линий.')
  const check = await inspect(tx, line)
  if (check.reason) throw new Error(check.reason)
  await tx.delete(dispatcherAcceptedWarnings).where(eq(dispatcherAcceptedWarnings.lineProgramId, line.id))
  await tx.delete(linePrograms).where(eq(linePrograms.id, line.id))
  await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes([line], new Map()) })
  return { id: line.id }
}
export const deleteLineProgram = createServerFn({ method: 'POST' }).validator(validate).handler(async ({ data }) => {
  await requirePermission('lines.delete')
  return requireDb().transaction(tx => deleteEmptyLineProgram(tx, data))
})
