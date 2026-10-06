import { PROGRAM_DEMAND_LABELS } from '@/lib/line-program-labels'
import { hashJsonRecordTuple } from './json-record-token'
import { deleteChangedProgramApprovals } from './program-approval-lifecycle'
import { createServerFn } from '@tanstack/react-start'
import { EXCLUDED_CONTROL_ASSIGNMENT_REASON, isActiveOfficialWeld } from '@/lib/control-assignment-eligibility'
import { and, eq, inArray, notExists, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { dispatcherAcceptedWarnings, generatedDocuments, generatedDocumentWeldJoints, linePrograms, weldJoints, type WeldJoint } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LAYERED_CONTROL_DOCUMENT_TYPES } from '@/lib/generated-document-types'
import { buildLayeredControlAssignment } from '@/lib/layered-control-rules'
import { getLineProgramOfficialStamps } from '@/lib/line-program-calculation'
import { previewProgramChanges, type ProgramChange } from '@/lib/line-program-workspace'
import { programExcessIdentity } from '@/lib/line-program-excess'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import { getLineProgramConfigurationIssue } from '@/lib/line-program'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import { getDispatcherDirtyScopes, markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { loadLineProgramRows, loadLineProgramOverviews, toLineProgramRecord } from '@/server/line-program'
import { assertSecurityScope } from '@/server/security-functions'
import { syncSystemDocumentsForWeldChangesInTransaction } from '@/server/system-document-index'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import { haveSameWeldLineMemberships, lockWeldLineMemberships, lockWeldLineMembershipsForWeldIds } from '@/server/weld-line-membership-lock'
import { assertExpectedInteractiveWeldVersions, lockInteractiveWeldRows } from '@/server/weld-row-version'
import { updateWeldJointsInBatches } from '@/server/weld-persistence'
import { loadServerWeldValidationContext, prepareServerWeldRecords, validateServerWeldRecords } from '@/server/weld-save-validation'
import { WELD_TABLE_RETURNING } from '@/server/weld-server-shared'
import { attachProgramRepairRequirements } from '@/lib/line-program-repair-requirements'
import type { ServerWeldValidationContext } from './weld-save-validation'

export type LineProgramControlRequest = {
  lineId: number; lineVersion: string; stamp?: string
  changes: ProgramChange[]; targets: WeldRowVersionTarget[]
  previewToken?: string; confirmedExcess?: boolean
}

export function getLineProgramControlToken(version: Date, rows: readonly WeldRow[], changes: readonly ProgramChange[]) {
  // The exact previous JSON protocol, streamed by record: no line-sized string
  // or UTF-8 copy. A single edited joint still checks every source of its quota.
  return hashJsonRecordTuple([version, rows, changes])
}

export async function persistLayeredControlFlags(tx: SystemDocumentSequenceTransaction, ids: number[], assigned: boolean) {
  if (!ids.length) return
  const previous = await tx.select().from(weldJoints).where(inArray(weldJoints.id, ids))
  const updated = await tx.update(weldJoints).set({ layeredControlAssigned: assigned, updatedAt: new Date() }).where(inArray(weldJoints.id, ids)).returning()
  await deleteChangedProgramApprovals(tx, updated, new Map(previous.map(row => [row.id, row])))
}

export const applyLineProgramControl = createServerFn({ method: 'POST' })
  .validator((data: LineProgramControlRequest) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    return requireDb().transaction(tx => changeProgramInTransaction(tx, data, false))
  })

export const previewLineProgramControl = createServerFn({ method: 'POST' })
  .validator((data: LineProgramControlRequest) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    return requireDb().transaction(tx => changeProgramInTransaction(tx, data, true))
  })

/** Preview and commit share validation; commit rechecks the whole calculation under the membership lock. */
export async function changeProgramInTransaction(tx: SystemDocumentSequenceTransaction, data: LineProgramControlRequest, previewOnly: boolean) {
      assertSelection(data.targets)
      const targetIds = new Set(data.targets.map(target => target.id))
      if (!Array.isArray(data.changes) || data.changes.length !== data.targets.length || new Set(data.changes.map(change => change.id)).size !== data.changes.length || data.changes.some(change => !targetIds.has(change.id) || !change.values || !Object.keys(change.values).length)) throw new Error('Передайте изменения для каждого выбранного стыка.')
      await loadControlProcessSettingsFromTransaction(tx)
      const [line] = await tx.select().from(linePrograms).where(eq(linePrograms.id, data.lineId)).limit(1)
      if (!line) throw new Error('Линия больше не существует.')
      await lockWeldLineMemberships(tx, [line])
      const [currentLine] = await tx.select().from(linePrograms).where(eq(linePrograms.id, data.lineId)).for('update')
      if (!currentLine || currentLine.updatedAt.toISOString() !== data.lineVersion) throw new Error('Программа линии изменилась. Обновите расчёт.')
      if (currentLine.configurationIssue || getLineProgramConfigurationIssue(currentLine) || currentLine.weldControlPercent == null || currentLine.pvkControlPercent == null) throw new Error('Сначала настройте программу линии (СП-02).')
      const ids = data.targets.map((target) => target.id)
      const storedRows = await lockInteractiveWeldRows(tx, ids)
      assertExpectedInteractiveWeldVersions(ids, data.targets, storedRows)
      if (storedRows.some((row) => row.lineProgramId !== line.id)) throw new Error('Выбранные стыки уже перенесены на другую линию.')
      const selectedRows = await attachDuplicateControlRelations(await attachHeatTreatmentControlRelations(storedRows as WeldRow[], tx), tx)
      if (data.stamp && selectedRows.some(row => !getLineProgramOfficialStamps(row).some(stamp => stamp.toLocaleLowerCase('ru') === data.stamp!.trim().toLocaleLowerCase('ru')))) throw new Error('Изменилось клеймо одного из выбранных стыков. Обновите данные.')
      const previousRows = new Map(selectedRows.map(row => [row.id, row]))
      const context = await loadServerWeldValidationContext(tx, selectedRows)
      const allRows = attachProgramRepairRequirements((await loadLineProgramRows(tx, currentLine)).map(row => previousRows.get(row.id) ?? row), context.programRules?.approved ?? new Set(), context.systemIndexSettings)
      const preview = previewProgramChanges(allRows, data.changes, currentLine, context.systemIndexSettings, context.programRules?.approved)
      if (preview.errors.length) throw new Error(preview.errors.join('\n'))
      const token = await getLineProgramControlToken(currentLine.updatedAt, allRows, data.changes)
      const result = { token, excess: new Set(preview.newExcess.map(programExcessIdentity)).size, changed: preview.records.length, rows: [] as WeldRow[], lineSummary: null as Awaited<ReturnType<typeof loadLineProgramOverviews>>[number] | null }
      // Run save checks for preview too; no documents, assignment flags or indexes are written.
      prepareServerWeldRecords({ records: preview.records, previousRows: previousRows as unknown as Map<number, WeldJoint>, context })
      validateServerWeldRecords({ records: preview.records, previousRows: previousRows as unknown as Map<number, WeldJoint>, context })
      if (previewOnly) return result
      if (data.previewToken !== token) throw new Error('Расчёт или выбор изменился после проверки. Повторно проверьте изменения; ничего не сохранено.')
      if (preview.newExcess.length && !data.confirmedExcess) throw new Error(`Подтвердите назначение сверх нормы или несколько способов контроля ${PROGRAM_DEMAND_LABELS.common}.`)
      result.rows = await saveAssignedRows(tx, preview.records, previousRows, preview.records.filter(row => row.layeredControlAssigned && !previousRows.get(row.id)?.layeredControlAssigned).map(row => row.id), context)
      if (preview.newExcess.length) await tx.insert(dispatcherAcceptedWarnings).values(preview.newExcess.map(entry => ({
        key: entry.key, weldJointId: entry.rowId, kind: 'line-program-control', title: 'Согласован лишний контроль',
        context: `${[line.projectTitle && `Проект: ${line.projectTitle}`, line.subtitleCode && `Шифр: ${line.subtitleCode}`, `Линия: ${line.line}`].filter(Boolean).join(' · ')} · ${entry.stamp ? `Клеймо: ${entry.stamp} · ` : ''}Стык ID ${entry.rowId} · ${PROGRAM_DEMAND_LABELS[entry.kind]}`,
      }))).onConflictDoNothing()
      result.lineSummary = (await loadLineProgramOverviews(tx, [toLineProgramRecord(currentLine)]))[0]
      return result
}

export const changeLayeredControl = createServerFn({ method: 'POST' })
  .validator((data: { targets: WeldRowVersionTarget[]; assigned: boolean; confirmPvk?: boolean; confirmedRemoval?: boolean }) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    assertSelection(data.targets)
    if (!data.assigned && !data.confirmedRemoval) throw new Error('Подтвердите удаление послойной отметки и четырёх послойных документов.')
    return requireDb().transaction(async (tx) => {
      await loadControlProcessSettingsFromTransaction(tx)
      const ids = data.targets.map((target) => target.id)
      const membership = await lockWeldLineMembershipsForWeldIds(tx, ids)
      const storedRows = await lockInteractiveWeldRows(tx, ids)
      if (!haveSameWeldLineMemberships(membership, storedRows)) throw new Error('Стыки перенесены на другую линию. Обновите данные.')
      assertExpectedInteractiveWeldVersions(ids, data.targets, storedRows)
      const rows = await attachDuplicateControlRelations(await attachHeatTreatmentControlRelations(storedRows as WeldRow[], tx), tx)
      if (rows.some(row => !isActiveOfficialWeld(row))) throw new Error(EXCLUDED_CONTROL_ASSIGNMENT_REASON)
      const previousRows = new Map(rows.map((row) => [row.id, row]))
      if (data.assigned) return saveAssignedRows(tx, rows.map((row) => buildLayeredControlAssignment(row, data.confirmPvk === true)), previousRows, ids)
      // Only the four dedicated types can be removed; ordinary requests/results are untouched.
      const links = await tx.select({ documentId: generatedDocumentWeldJoints.documentId }).from(generatedDocumentWeldJoints)
        .innerJoin(generatedDocuments, eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId))
        .where(and(inArray(generatedDocumentWeldJoints.weldJointId, ids), inArray(generatedDocuments.type, [...LAYERED_CONTROL_DOCUMENT_TYPES])))
      const documentIds = [...new Set(links.map((link) => link.documentId))]
      if (documentIds.length) {
        await tx.delete(generatedDocumentWeldJoints).where(and(inArray(generatedDocumentWeldJoints.weldJointId, ids), inArray(generatedDocumentWeldJoints.documentId, documentIds)))
        await tx.delete(generatedDocuments).where(and(inArray(generatedDocuments.id, documentIds), notExists(tx.select({ one: sql`1` }).from(generatedDocumentWeldJoints).where(eq(generatedDocumentWeldJoints.documentId, generatedDocuments.id)))))
      }
      await persistLayeredControlFlags(tx, ids, false)
      await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(rows, previousRows) })
      return tx.select(WELD_TABLE_RETURNING).from(weldJoints).where(inArray(weldJoints.id, ids))
    })
  })

async function saveAssignedRows(tx: SystemDocumentSequenceTransaction, records: WeldRow[], previousRows: Map<number, WeldRow>, layeredIds: number[], loadedContext?: ServerWeldValidationContext) {
  const context = loadedContext ?? await loadServerWeldValidationContext(tx, records)
  const storedPreviousRows = previousRows as unknown as Map<number, WeldJoint>
  prepareServerWeldRecords({ records, previousRows: storedPreviousRows, context })
  validateServerWeldRecords({ records, previousRows: storedPreviousRows, context })
  await persistLayeredControlFlags(tx, layeredIds, true)
  const saved = await updateWeldJointsInBatches(tx, records, storedPreviousRows)
  await syncSystemDocumentsForWeldChangesInTransaction(tx, saved, previousRows)
  await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(records, previousRows) })
  return saved
}
function assertSelection(targets: readonly WeldRowVersionTarget[]) {
  if (!Array.isArray(targets) || !targets.length || targets.length > 1000 || new Set(targets.map((target) => target.id)).size !== targets.length ||
    targets.some((target) => !Number.isSafeInteger(target.id) || target.id <= 0 || !target.version)) throw new Error('Выберите от 1 до 1000 стыков с актуальными версиями.')
}
