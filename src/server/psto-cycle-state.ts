import { eq, inArray, sql } from 'drizzle-orm'

import { pstoRepeatCycles, weldJoints, type NewPstoRepeatCycle } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { PstoCycleCorrectionResult } from '@/lib/psto-cycle-corrections'
import {
  buildPstoCycleTimeline,
  type PstoCycleSnapshot,
  type PstoRepeatCycleRecord,
} from '@/lib/psto-cycle'
import type { PstoRepeatCycleWrite } from '@/lib/psto-repeat-cycle-updates'
import { calculateFinalStatus } from '@/lib/weld-status'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'

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
  const primaryRows = await savePrimaryPstoCycleRows(
    tx,
    writes.flatMap((write) => write.source === 'primary' ? [write.row] : []),
  )
  const repeatRows = await touchRowsWithRepeatCycles(tx, sourceRows, repeatCycles)
  return [...new Map(
    [...primaryRows, ...repeatRows].map((row) => [row.id, row]),
  ).values()]
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
      .returning()
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
      finalStatus: textOrNull(correction.row.finalStatus),
      pstoCreatedAt: sql`coalesce(${weldJoints.pstoCreatedAt}, ${now})`,
      pstoUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(weldJoints.id, currentRow.id))
    .returning()
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
    return tx
      .insert(pstoRepeatCycles)
      .values(writes.map(toRepeatCycleInsert))
      .returning()
  }
  const saved: PstoRepeatCycleRecord[] = []
  for (const write of writes) {
    if (!write.id) throw new Error('Не найден текущий повторный цикл ПСТО.')
    const [updated] = await tx
      .update(pstoRepeatCycles)
      .set({ ...toRepeatCycleInsert(write), updatedAt: new Date() })
      .where(eq(pstoRepeatCycles.id, write.id))
      .returning()
    if (!updated) throw new Error('Повторный цикл ПСТО уже изменен. Обновите отчет.')
    saved.push(updated)
  }
  return saved
}

export async function deletePstoRepeatCyclesInTransaction(
  tx: SystemDocumentSequenceTransaction,
  cycleIds: readonly number[],
) {
  const ids = [...new Set(cycleIds
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))]
  if (ids.length === 0) return
  await tx.delete(pstoRepeatCycles).where(inArray(pstoRepeatCycles.id, ids))
}

async function savePrimaryPstoCycleRows(
  tx: SystemDocumentSequenceTransaction,
  rows: WeldRow[],
) {
  const saved: WeldRow[] = []
  for (const row of rows) {
    const [updated] = await tx
      .update(weldJoints)
      .set({
        ...getPrimaryPstoCyclePersistenceValues(row),
        finalStatus: textOrNull(row.finalStatus),
        pstoCreatedAt: sql`coalesce(${weldJoints.pstoCreatedAt}, now())`,
        pstoUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(weldJoints.id, row.id))
      .returning()
    if (!updated) throw new Error(`Стык ${row.id} больше не существует.`)
    saved.push({ ...updated, pstoRepeatCycles: row.pstoRepeatCycles ?? [] } as WeldRow)
  }
  return saved
}

async function touchRowsWithRepeatCycles(
  tx: SystemDocumentSequenceTransaction,
  rows: WeldRow[],
  cycles: PstoRepeatCycleRecord[],
) {
  const cyclesByWeldId = new Map<number, PstoRepeatCycleRecord[]>()
  for (const cycle of cycles) {
    const current = cyclesByWeldId.get(cycle.weldJointId) ?? []
    current.push(cycle)
    cyclesByWeldId.set(cycle.weldJointId, current)
  }
  const now = new Date()
  const updatedRows: WeldRow[] = []
  for (const row of rows) {
    const changedCycles = cyclesByWeldId.get(row.id)
    if (!changedCycles) continue
    const nextCycles = [
      ...(row.pstoRepeatCycles ?? []).filter(
        (cycle) => !changedCycles.some((changed) => changed.id === cycle.id),
      ),
      ...changedCycles,
    ].sort((left, right) => left.sequence - right.sequence)
    const nextRow: WeldRow = { ...row, pstoRepeatCycles: nextCycles }
    const [updated] = await tx
      .update(weldJoints)
      .set({
        finalStatus: calculateFinalStatus(nextRow),
        pstoCreatedAt: sql`coalesce(${weldJoints.pstoCreatedAt}, ${now})`,
        pstoUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(weldJoints.id, row.id))
      .returning()
    if (!updated) throw new Error(`Стык ${row.id} больше не существует.`)
    updatedRows.push({ ...updated, pstoRepeatCycles: nextCycles } as WeldRow)
  }
  return updatedRows
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

function textOrNull(value: unknown) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}
