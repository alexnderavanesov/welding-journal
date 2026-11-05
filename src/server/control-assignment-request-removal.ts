import { preHeatTreatmentControls } from '@/db/schema'
import type { WeldInput } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { SystemDocumentSourcePosition } from '@/lib/system-document-types'
import { ALL_LNK_FIELD_METHODS } from '@/lib/lnk-report-config'
import { getClearedControlAssignments, clearRequestsForRemovedControlAssignments } from '@/lib/control-assignment-request-removal'
import { removeSourcedSystemDocumentPositionsInTransaction } from './system-document-index'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildNumberArrayMatch } from './weld-request-utils'
import { attachPreHeatTreatmentControlRelations, attachPstoRepeatCycleRelations } from './heat-treatment-control-relations'
import { attachDuplicateControlRelations } from './duplicate-control-relations'
import { clearPendingPstoRepeatRequests } from './psto-cycle-state'

/** Caller owns the weld locks and has validated the final merged records.
 * Primary fields are persisted by its usual write; this handles owned relations
 * and sourced request documents in the same transaction. */
export async function persistRemovedControlAssignmentRequests(
  tx: SystemDocumentSequenceTransaction,
  records: readonly WeldInput[],
  previousRows: ReadonlyMap<number, WeldInput>,
  options: { transferredPreControlIds?: readonly number[]; preserveRecordedControlHistoryRowIds?: ReadonlySet<number> } = {},
) {
  const candidates = records.flatMap(record => {
    const stored = previousRows.get(Number(record.id))
    // An already validated line move retains every historical stage. Its
    // derived PSTO assignment is not an instruction to clear those stages.
    // This server-only option never exempts a simultaneous NK method change.
    const previous = stored && options.preserveRecordedControlHistoryRowIds?.has(Number(record.id))
      ? { ...stored, pstoRequired: record.pstoRequired }
      : stored
    return previous && getClearedControlAssignments(record, previous).length ? [previous as WeldRow] : []
  })
  if (!candidates.length) return
  // Some dedicated request workflows only hydrate the primary row. Parent weld
  // locks also serialize all relation writes; read their current facts here.
  const stored = await attachDuplicateControlRelations(
    await attachPstoRepeatCycleRelations(await attachPreHeatTreatmentControlRelations(candidates, tx), tx), tx,
  )
  const transferred = new Set(options.transferredPreControlIds)
  const authoritative = new Map(stored.map(row => [row.id, {
    ...row,
    // Explicit validated whole-package transfers preserve these facts in the
    // primary stage and own their document transfer, rather than deleting them.
    preHeatTreatmentControls: row.preHeatTreatmentControls?.filter(control => !transferred.has(control.id)),
  }]))
  const preIds = new Set<number>(), pstoRepeatIds = new Set<number>(), tvmtRepeatIds = new Set<number>()
  const pstoPositions: SystemDocumentSourcePosition[] = [], tvmtPositions: SystemDocumentSourcePosition[] = []
  for (const record of records) {
    const previous = authoritative.get(Number(record.id))
    if (!previous) continue
    const fields = new Set(getClearedControlAssignments(record, previous))
    if (!fields.size) continue
    // Recheck stored own facts even if a client supplied a misleading empty relation list.
    clearRequestsForRemovedControlAssignments(record, previous)
    const removesPsto = fields.has('pstoRequired')
    const methods = new Set(ALL_LNK_FIELD_METHODS.filter(method => fields.has(method.enabledKey)).map(method => method.code))
    if (removesPsto) methods.add('ТВМТ')
    for (const control of previous.preHeatTreatmentControls ?? []) if (removesPsto || methods.has(control.method as typeof ALL_LNK_FIELD_METHODS[number]['code'])) preIds.add(control.id)
    const addPosition = (positions: SystemDocumentSourcePosition[], relationId: number, sequence: number, methodCode?: string) =>
      positions.push({ kind: 'pstoCycle', weldJointId: previous.id, relationId, sequence, ...(methodCode ? { methodCode } : {}) })
    if (removesPsto) addPosition(pstoPositions, previous.id, 1)
    if (methods.has('ТВМТ')) addPosition(tvmtPositions, previous.id, 1, 'ТВМТ')
    for (const cycle of previous.pstoRepeatCycles ?? []) {
      if (removesPsto) { pstoRepeatIds.add(cycle.id); addPosition(pstoPositions, cycle.id, cycle.sequence) }
      if (methods.has('ТВМТ')) { tvmtRepeatIds.add(cycle.id); addPosition(tvmtPositions, cycle.id, cycle.sequence, 'ТВМТ') }
    }
  }
  if (preIds.size) {
    await removeSourcedSystemDocumentPositionsInTransaction({ tx, sourceKind: 'beforeHeatTreatment', relationIds: [...preIds], documentTypes: ['lnkRequest'] })
    await tx.update(preHeatTreatmentControls).set({ requestName: null, requestDate: null, result: null, updatedAt: new Date() })
      .where(buildNumberArrayMatch(preHeatTreatmentControls.id, [...preIds]))
  }
  for (const { ids, positions, documentType, kind } of [
    { ids: pstoRepeatIds, positions: pstoPositions, documentType: 'pstoRequest' as const, kind: 'psto' as const },
    { ids: tvmtRepeatIds, positions: tvmtPositions, documentType: 'lnkRequest' as const, kind: 'tvmt' as const },
  ]) {
    if (positions.length) await removeSourcedSystemDocumentPositionsInTransaction({ tx, sourceKind: 'pstoCycle', sourcePositions: positions, documentTypes: [documentType] })
    if (ids.size) {
      // Older repeat documents use the same relation but a distinct source kind.
      await removeSourcedSystemDocumentPositionsInTransaction({ tx, sourceKind: 'pstoRepeat', relationIds: [...ids], documentTypes: [documentType] })
      await clearPendingPstoRepeatRequests(tx, [...ids], kind)
    }
  }
}
