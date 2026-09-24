import { asc, eq } from 'drizzle-orm'

import { requireDb } from '@/db'
import { appSettings, preHeatTreatmentControls, pstoRepeatCycles } from '@/db/schema'
import { normalizeControlProcessSettings, type ControlProcessSettings } from '@/lib/control-process-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import {
  mergePreHeatTreatmentControlsIntoRows,
  mergePstoRepeatCyclesIntoRows,
  type HeatTreatmentControlRelationsCarrier,
} from '@/lib/heat-treatment-control-relations'
import { buildNumberArrayMatch } from '@/server/weld-request-utils'

type RelationDb = Pick<ReturnType<typeof requireDb>, 'select'>

export async function attachHeatTreatmentControlRelations<
  Row extends HeatTreatmentControlRelationsCarrier,
>(rows: readonly Row[], db: RelationDb = requireDb()): Promise<Array<Row & HeatTreatmentControlRelationsCarrier>> {
  const rowsWithPreControls = await attachPreHeatTreatmentControlRelations(rows, db)
  if (rows.length === 0) return rowsWithPreControls
  const rowIds = getRelationRowIds(rows)
  if (rowIds.length === 0) return rowsWithPreControls

  const repeatCycles = await db
    .select()
    .from(pstoRepeatCycles)
    .where(buildNumberArrayMatch(pstoRepeatCycles.weldJointId, rowIds))
    .orderBy(
      asc(pstoRepeatCycles.weldJointId),
      asc(pstoRepeatCycles.sequence),
      asc(pstoRepeatCycles.id),
    )

  const hydrated = mergePstoRepeatCyclesIntoRows(rowsWithPreControls, repeatCycles)
  return attachCurrentPolicy(hydrated, db)
}

/**
 * Full dispatcher refresh owns its freshly selected rows. Attach relations to
 * those objects in place so a 200k-row calculation does not retain two extra
 * copies of the complete weld table.
 */
export async function attachHeatTreatmentControlRelationsInPlace<
  Row extends HeatTreatmentControlRelationsCarrier,
>(rows: Row[], db: RelationDb = requireDb(), settings?: ControlProcessSettings) {
  if (rows.length === 0) return rows
  const rowIds = getRelationRowIds(rows)
  if (rowIds.length === 0) return rows

  const preHeatControls = await db
    .select()
    .from(preHeatTreatmentControls)
    .where(buildNumberArrayMatch(preHeatTreatmentControls.weldJointId, rowIds))
    .orderBy(
      asc(preHeatTreatmentControls.weldJointId),
      asc(preHeatTreatmentControls.method),
      asc(preHeatTreatmentControls.id),
    )
  const preControlsByWeldId = groupRelationsByWeldId(preHeatControls)
  for (const row of rows) {
    const controls = preControlsByWeldId.get(row.id) ?? []
    if (controls.length > 0) row.preHeatTreatmentControls = controls
  }

  const repeatCycles = await db
    .select()
    .from(pstoRepeatCycles)
    .where(buildNumberArrayMatch(pstoRepeatCycles.weldJointId, rowIds))
    .orderBy(
      asc(pstoRepeatCycles.weldJointId),
      asc(pstoRepeatCycles.sequence),
      asc(pstoRepeatCycles.id),
    )
  const repeatCyclesByWeldId = groupRelationsByWeldId(repeatCycles)
  for (const row of rows) {
    const cycles = repeatCyclesByWeldId.get(row.id)
    if (cycles?.length) row.pstoRepeatCycles = cycles
  }
  return attachCurrentPolicy(rows, db, settings)
}

async function attachCurrentPolicy<Row extends HeatTreatmentControlRelationsCarrier>(
  rows: Row[], db: RelationDb, settings?: ControlProcessSettings,
) {
  if (!settings) {
    const [stored] = await db.select({ value: appSettings.value }).from(appSettings)
      .where(eq(appSettings.key, PROJECT_SETTING_KEYS.controlProcesses)).orderBy(appSettings.key)
    let value: unknown
    try { value = stored ? JSON.parse(stored.value) : undefined } catch { value = undefined }
    settings = normalizeControlProcessSettings(value)
  }
  for (const row of rows) {
    row.preHeatTreatmentLnkEnabled = settings.preHeatTreatmentLnkEnabled
  }
  return rows
}

export async function attachPreHeatTreatmentControlRelations<
  Row extends HeatTreatmentControlRelationsCarrier,
>(rows: readonly Row[], db: RelationDb = requireDb()) {
  if (rows.length === 0) return []
  const rowIds = getRelationRowIds(rows)
  if (rowIds.length === 0) return [...rows]

  const preHeatControls = await db
    .select()
    .from(preHeatTreatmentControls)
    .where(buildNumberArrayMatch(preHeatTreatmentControls.weldJointId, rowIds))
    .orderBy(
      asc(preHeatTreatmentControls.weldJointId),
      asc(preHeatTreatmentControls.method),
      asc(preHeatTreatmentControls.id),
    )
  return mergePreHeatTreatmentControlsIntoRows(rows, preHeatControls)
}

function getRelationRowIds(rows: readonly HeatTreatmentControlRelationsCarrier[]) {
  return [...new Set(rows.map((row) => Number(row.id)).filter(Number.isFinite))]
}

function groupRelationsByWeldId<Relation extends { weldJointId: number }>(relations: readonly Relation[]) {
  const relationsByWeldId = new Map<number, Relation[]>()
  for (const relation of relations) {
    const current = relationsByWeldId.get(relation.weldJointId)
    if (current) current.push(relation)
    else relationsByWeldId.set(relation.weldJointId, [relation])
  }
  return relationsByWeldId
}
