import { eq, sql } from 'drizzle-orm'

import { pstoRepeatCycles, weldJoints, type NewPstoRepeatCycle } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { PstoCycleCorrectionResult } from '@/lib/psto-cycle-corrections'
import {
  buildPstoCycleTimeline,
  type PstoCycleSnapshot,
  type PstoRepeatCycleRecord,
} from '@/lib/psto-cycle'
import type { PstoRepeatCycleWrite } from '@/lib/psto-repeat-cycle-updates'
import { splitWeldImportInsertBatches } from '@/lib/weld-import-limits'
import { calculateFinalStatus } from '@/lib/weld-status'
import { getPreHeatTreatmentExemptionForSave } from '@/lib/pre-heat-treatment-policy'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import { buildNumberArrayMatch } from '@/server/weld-request-utils'
import { WELD_TABLE_RETURNING } from '@/server/weld-server-shared'

export type PstoCycleWorkflowAction =
  | 'pstoRequest'
  | 'pstoResult'
  | 'tvmtRequest'
  | 'tvmtResult'

export type PstoCycleWorkflowWrite =
  | { source: 'primary'; row: WeldRow }
  | { source: 'repeat'; cycle: PstoRepeatCycleWrite }

export function getPstoCycleState(row: WeldRow): PstoCycleSnapshot[] {
  return buildPstoCycleTimeline(row, row.pstoRepeatCycles ?? [])
}

export function getPrimaryPstoCyclePersistenceValues(row: WeldRow) {
  return {
    preHeatTreatmentLnkExempt: getPreHeatTreatmentExemptionForSave(row),
    pstoRequest: textOrNull(row.pstoRequest),
    pstoRequestDate: textOrNull(row.pstoRequestDate),
    pstoDate: textOrNull(row.pstoDate),
    heatTreatmentDiagram: textOrNull(row.heatTreatmentDiagram),
    pstoResult: textOrNull(row.pstoResult),
    pstoNote: textOrNull(row.pstoNote),
    tvmtRequest: textOrNull(row.tvmtRequest),
    tvmtRequestDate: textOrNull(row.tvmtRequestDate),
    tvmtResult: textOrNull(row.tvmtResult),
    tvmtConclusionDate: textOrNull(row.tvmtConclusionDate),
    tvmtConclusion: textOrNull(row.tvmtConclusion),
  }
}

export async function persistPstoCycleWorkflowWrites({
  tx,
  action,
  sourceRows,
  writes,
}: {
  tx: SystemDocumentSequenceTransaction
  action: PstoCycleWorkflowAction
  sourceRows: WeldRow[]
  writes: PstoCycleWorkflowWrite[]
}) {
  const repeatCycles = await saveRepeatCycleWrites(
    tx,
    action,
    writes.flatMap((write) => write.source === 'repeat' ? [write.cycle] : []),
  )
  const primaryRows = writes.flatMap((write) => write.source === 'primary' ? [write.row] : [])
  const repeatRows = applyRepeatCyclesToRows(sourceRows, repeatCycles)
  const nextRows = [...new Map(
    [...primaryRows, ...repeatRows].map((row) => [row.id, row]),
  ).values()]
  return savePstoCycleRowsInBatches(tx, nextRows)
}

export async function persistPstoCycleCorrection({
  tx,
  currentRow,
  correction,
  sequence,
  now = new Date(),
}: {
  tx: SystemDocumentSequenceTransaction
  currentRow: WeldRow
  correction: PstoCycleCorrectionResult
  sequence: number
  now?: Date
}) {
  if (sequence === 1) {
    const [updated] = await tx
      .update(weldJoints)
      .set({
        ...getPrimaryPstoCyclePersistenceValues(correction.row),
        finalStatus: textOrNull(correction.row.finalStatus),
        pstoCreatedAt: sql`coalesce(${weldJoints.pstoCreatedAt}, ${now})`,
        pstoUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(weldJoints.id, currentRow.id))
      .returning(WELD_TABLE_RETURNING)
    if (!updated) throw new Error('Стык больше не существует. Обновите отчет ПСТО.')
    return { ...updated, pstoRepeatCycles: currentRow.pstoRepeatCycles ?? [] } as WeldRow
  }

  const relationId = correction.repeatCycle?.id ?? correction.deletedRepeatCycleId
  if (!relationId) throw new Error('Повторный цикл больше не существует. Обновите отчет ПСТО.')
  if (correction.deletedRepeatCycleId) {
    await tx
      .delete(pstoRepeatCycles)
      .where(eq(pstoRepeatCycles.id, correction.deletedRepeatCycleId))
  } else if (correction.repeatCycle) {
    const [savedCycle] = await tx
      .update(pstoRepeatCycles)
      .set({ ...toRepeatCycleInsert(correction.repeatCycle), updatedAt: now })
      .where(eq(pstoRepeatCycles.id, relationId))
      .returning()
    if (!savedCycle) throw new Error('Повторный цикл уже изменен. Обновите отчет ПСТО.')
  }

  const [updated] = await tx
    .update(weldJoints)
    .set({
      preHeatTreatmentLnkExempt: getPreHeatTreatmentExemptionForSave(correction.row, currentRow),
      finalStatus: textOrNull(correction.row.finalStatus),
      pstoCreatedAt: sql`coalesce(${weldJoints.pstoCreatedAt}, ${now})`,
      pstoUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(weldJoints.id, currentRow.id))
    .returning(WELD_TABLE_RETURNING)
  if (!updated) throw new Error('Стык больше не существует. Обновите отчет ПСТО.')
  return {
    ...updated,
    pstoRepeatCycles: correction.row.pstoRepeatCycles ?? [],
  } as WeldRow
}

export async function saveRepeatCycleWrites(
  tx: SystemDocumentSequenceTransaction,
  action: PstoCycleWorkflowAction,
  writes: PstoRepeatCycleWrite[],
) {
  if (writes.length === 0) return []
  if (action === 'pstoRequest') {
    const writeKeys = writes.map(getRepeatCycleWriteKey)
    if (new Set(writeKeys).size !== writeKeys.length) {
      throw new Error('Один повторный цикл нельзя создать дважды за одно сохранение.')
    }
    const saved: PstoRepeatCycleRecord[] = []
    for (const batch of splitWeldImportInsertBatches(writes)) {
      saved.push(...await tx
        .insert(pstoRepeatCycles)
        .values(batch.map(toRepeatCycleInsert))
        .returning())
    }
    const savedByKey = new Map(saved.map((cycle) => [getRepeatCycleWriteKey(cycle), cycle]))
    return writeKeys.map((key) => {
      const cycle = savedByKey.get(key)
      if (!cycle) throw new Error('Не удалось создать все повторные циклы. Ничего не сохранено.')
      return cycle
    })
  }
  return updateExistingRepeatCycleWrites(tx, writes)
}

export async function updatePstoRepeatCycleRecords(
  tx: SystemDocumentSequenceTransaction,
  cycles: PstoRepeatCycleRecord[],
) {
  return updateExistingRepeatCycleWrites(tx, cycles)
}

async function updateExistingRepeatCycleWrites(
  tx: SystemDocumentSequenceTransaction,
  writes: PstoRepeatCycleWrite[],
) {
  if (writes.length === 0) return []
  const ids = writes.map((write) => {
    if (!write.id) throw new Error('Не найден текущий повторный цикл ПСТО.')
    return write.id
  })
  if (new Set(ids).size !== ids.length) {
    throw new Error('Один повторный цикл нельзя изменить дважды за одно сохранение.')
  }
  const locked = await tx
    .select({ id: pstoRepeatCycles.id })
    .from(pstoRepeatCycles)
    .where(buildNumberArrayMatch(
      pstoRepeatCycles.id,
      [...ids].sort((left, right) => left - right),
    ))
    .orderBy(pstoRepeatCycles.id)
    .for('update')
  if (locked.length !== ids.length) {
    throw new Error('Один или несколько повторных циклов уже изменены. Обновите отчет.')
  }

  const now = new Date()
  const payloads = writes.map((write) => ({
    id: write.id!,
    ...toRepeatCycleInsert(write),
    updatedAt: now,
  }))
  const saved: PstoRepeatCycleRecord[] = []
  for (const batch of splitWeldImportInsertBatches(payloads)) {
    const updated = await tx
      .insert(pstoRepeatCycles)
      .values(batch)
      .onConflictDoUpdate({
        target: pstoRepeatCycles.id,
        set: {
          weldJointId: sql`excluded."weld_joint_id"`,
          sequence: sql`excluded."sequence"`,
          pstoRequest: sql`excluded."psto_request"`,
          pstoRequestDate: sql`excluded."psto_request_date"`,
          pstoDate: sql`excluded."psto_date"`,
          heatTreatmentDiagram: sql`excluded."heat_treatment_diagram"`,
          pstoResult: sql`excluded."psto_result"`,
          pstoNote: sql`excluded."psto_note"`,
          tvmtRequest: sql`excluded."tvmt_request"`,
          tvmtRequestDate: sql`excluded."tvmt_request_date"`,
          tvmtResult: sql`excluded."tvmt_result"`,
          tvmtConclusionDate: sql`excluded."tvmt_conclusion_date"`,
          tvmtConclusion: sql`excluded."tvmt_conclusion"`,
          updatedAt: sql`excluded."updated_at"`,
        },
      })
      .returning()
    saved.push(...updated)
  }
  const savedById = new Map(saved.map((cycle) => [cycle.id, cycle]))
  return ids.map((id) => {
    const cycle = savedById.get(id)
    if (!cycle) throw new Error('Не удалось сохранить все повторные циклы. Ничего не сохранено.')
    return cycle
  })
}

export async function deletePstoRepeatCyclesInTransaction(
  tx: SystemDocumentSequenceTransaction,
  cycleIds: readonly number[],
) {
  const ids = [...new Set(cycleIds
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))]
    .sort((left, right) => left - right)
  if (ids.length === 0) return
  await tx
    .delete(pstoRepeatCycles)
    .where(buildNumberArrayMatch(pstoRepeatCycles.id, ids))
}

export async function savePstoCycleRowsInBatches(
  tx: SystemDocumentSequenceTransaction,
  rows: WeldRow[],
) {
  if (rows.length === 0) return []
  const now = new Date()
  const payloads = rows.map((row) => ({
    id: row.id,
    ...getPrimaryPstoCyclePersistenceValues(row),
    finalStatus: textOrNull(calculateFinalStatus(row)),
    pstoCreatedAt: now,
    pstoUpdatedAt: now,
    updatedAt: now,
  }))
  const saved: WeldRow[] = []
  for (const batch of splitWeldImportInsertBatches(payloads)) {
    const updated = await tx
      .insert(weldJoints)
      .values(batch)
      .onConflictDoUpdate({
        target: weldJoints.id,
        set: {
          preHeatTreatmentLnkExempt: sql`excluded."pre_heat_treatment_lnk_exempt"`,
          pstoRequest: sql`excluded."psto_request"`,
          pstoRequestDate: sql`excluded."psto_request_date"`,
          pstoDate: sql`excluded."psto_date"`,
          heatTreatmentDiagram: sql`excluded."heat_treatment_diagram"`,
          pstoResult: sql`excluded."psto_result"`,
          pstoNote: sql`excluded."psto_note"`,
          tvmtRequest: sql`excluded."tvmt_request"`,
          tvmtRequestDate: sql`excluded."tvmt_request_date"`,
          tvmtResult: sql`excluded."tvmt_result"`,
          tvmtConclusionDate: sql`excluded."tvmt_conclusion_date"`,
          tvmtConclusion: sql`excluded."tvmt_conclusion"`,
          finalStatus: sql`excluded."final_status"`,
          pstoCreatedAt: sql`coalesce(${weldJoints.pstoCreatedAt}, excluded."psto_created_at")`,
          pstoUpdatedAt: sql`excluded."psto_updated_at"`,
          updatedAt: sql`excluded."updated_at"`,
        },
      })
      .returning(WELD_TABLE_RETURNING)
    saved.push(...updated as WeldRow[])
  }
  const savedById = new Map(saved.map((row) => [row.id, row]))
  return rows.map((row) => {
    const updated = savedById.get(row.id)
    if (!updated) throw new Error(`Стык ${row.id} больше не существует.`)
    return { ...updated, pstoRepeatCycles: row.pstoRepeatCycles ?? [] } as WeldRow
  })
}

function applyRepeatCyclesToRows(
  rows: WeldRow[],
  cycles: PstoRepeatCycleRecord[],
) {
  const cyclesByWeldId = new Map<number, PstoRepeatCycleRecord[]>()
  for (const cycle of cycles) {
    const current = cyclesByWeldId.get(cycle.weldJointId) ?? []
    current.push(cycle)
    cyclesByWeldId.set(cycle.weldJointId, current)
  }
  return rows.flatMap((row) => {
    const changedCycles = cyclesByWeldId.get(row.id)
    if (!changedCycles) return []
    const nextCycles = [
      ...(row.pstoRepeatCycles ?? []).filter(
        (cycle) => !changedCycles.some((changed) => changed.id === cycle.id),
      ),
      ...changedCycles,
    ].sort((left, right) => left.sequence - right.sequence)
    return [{ ...row, pstoRepeatCycles: nextCycles } as WeldRow]
  })
}

function toRepeatCycleInsert(write: PstoRepeatCycleWrite | PstoRepeatCycleRecord): NewPstoRepeatCycle {
  return {
    weldJointId: write.weldJointId,
    sequence: write.sequence,
    pstoRequest: textOrNull(write.pstoRequest),
    pstoRequestDate: textOrNull(write.pstoRequestDate),
    pstoDate: textOrNull(write.pstoDate),
    heatTreatmentDiagram: textOrNull(write.heatTreatmentDiagram),
    pstoResult: textOrNull(write.pstoResult),
    pstoNote: textOrNull(write.pstoNote),
    tvmtRequest: textOrNull(write.tvmtRequest),
    tvmtRequestDate: textOrNull(write.tvmtRequestDate),
    tvmtResult: textOrNull(write.tvmtResult),
    tvmtConclusionDate: textOrNull(write.tvmtConclusionDate),
    tvmtConclusion: textOrNull(write.tvmtConclusion),
  }
}

function getRepeatCycleWriteKey(write: Pick<PstoRepeatCycleWrite, 'weldJointId' | 'sequence'>) {
  return `${write.weldJointId}:${write.sequence}`
}

function textOrNull(value: unknown) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}
