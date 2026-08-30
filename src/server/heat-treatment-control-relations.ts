import { asc, inArray } from 'drizzle-orm'

import { requireDb } from '@/db'
import { preHeatTreatmentControls, pstoRepeatCycles } from '@/db/schema'
import {
  mergePreHeatTreatmentControlsIntoRows,
  mergePstoRepeatCyclesIntoRows,
  type HeatTreatmentControlRelationsCarrier,
} from '@/lib/heat-treatment-control-relations'

const RELATION_QUERY_CHUNK_SIZE = 1000
type RelationDb = Pick<ReturnType<typeof requireDb>, 'select'>

export async function attachHeatTreatmentControlRelations<
  Row extends HeatTreatmentControlRelationsCarrier,
>(rows: readonly Row[], db: RelationDb = requireDb()) {
  if (rows.length === 0) return []
  const ids = [...new Set(rows.map((row) => Number(row.id)).filter(Number.isFinite))]
  if (ids.length === 0) return [...rows]

  const idChunks = Array.from(
    { length: Math.ceil(ids.length / RELATION_QUERY_CHUNK_SIZE) },
    (_, index) => ids.slice(
      index * RELATION_QUERY_CHUNK_SIZE,
      (index + 1) * RELATION_QUERY_CHUNK_SIZE,
    ),
  )

  // This helper is also used with a transaction-bound client. node-postgres
  // requires queries on one transaction connection to run sequentially.
  const preHeatControls = [] as Array<typeof preHeatTreatmentControls.$inferSelect>
  const repeatCycles = [] as Array<typeof pstoRepeatCycles.$inferSelect>
  for (const idChunk of idChunks) {
    preHeatControls.push(...await db
      .select()
      .from(preHeatTreatmentControls)
      .where(inArray(preHeatTreatmentControls.weldJointId, idChunk))
      .orderBy(
        asc(preHeatTreatmentControls.weldJointId),
        asc(preHeatTreatmentControls.method),
        asc(preHeatTreatmentControls.id),
      ))
  }
  for (const idChunk of idChunks) {
    repeatCycles.push(...await db
      .select()
      .from(pstoRepeatCycles)
      .where(inArray(pstoRepeatCycles.weldJointId, idChunk))
      .orderBy(
        asc(pstoRepeatCycles.weldJointId),
        asc(pstoRepeatCycles.sequence),
        asc(pstoRepeatCycles.id),
      ))
  }

  return mergePstoRepeatCyclesIntoRows(
    mergePreHeatTreatmentControlsIntoRows(rows, preHeatControls),
    repeatCycles,
  )
}
