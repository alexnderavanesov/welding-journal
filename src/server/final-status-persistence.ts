import { auditSql } from './audit-functions'
import { sql, type SQL } from 'drizzle-orm'

import { weldJoints } from '@/db/schema'

// Array parameters keep the SQL/parameter count constant; match the existing
// bounded dispatcher staging batch rather than rescanning the table per 10k.
export const FINAL_STATUS_UPDATE_BATCH_SIZE = 50_000

type FinalStatusRow = {
  id: number
  finalStatus?: unknown
}

type FinalStatusExecutor = {
  execute: (query: SQL) => PromiseLike<unknown>
}

export function getFinalStatusPersistenceChanges(
  sourceRows: ReadonlyArray<FinalStatusRow>,
  preparedRows: ReadonlyArray<FinalStatusRow>,
) {
  const sourceById = new Map(sourceRows.map((row) => [row.id, row.finalStatus ?? null]))
  return preparedRows.flatMap((row) => {
    const previousFinalStatus = sourceById.get(row.id)
    const finalStatus = row.finalStatus ?? null
    return previousFinalStatus !== undefined && previousFinalStatus !== finalStatus
      ? [{ id: row.id, previousFinalStatus, finalStatus }]
      : []
  })
}

export async function persistCalculatedFinalStatuses(
  executor: FinalStatusExecutor,
  sourceRows: ReadonlyArray<FinalStatusRow>,
  preparedRows: ReadonlyArray<FinalStatusRow>,
) {
  const rowsAreAligned = sourceRows.length === preparedRows.length && sourceRows.every(
    (row, index) => row.id === preparedRows[index]?.id,
  )
  const pendingChanges: ReturnType<typeof getFinalStatusPersistenceChanges> = []
  let changeCount = 0
  const flushChanges = async () => {
    if (pendingChanges.length === 0) return
    const chunk = pendingChanges.splice(0, pendingChanges.length)
    changeCount += chunk.length
    await auditSql(executor, [{ table: weldJoints, where: sql`${weldJoints.id} = any(${sql.param(chunk.map(change => change.id))}::integer[])` }], () => executor.execute(sql`
      update ${weldJoints} as "target"
      set "final_status" = "changes"."final_status"
      from unnest(
        ${sql.param(chunk.map(change => change.id))}::integer[],
        ${sql.param(chunk.map(change => change.previousFinalStatus))}::text[],
        ${sql.param(chunk.map(change => change.finalStatus))}::text[]
      ) as "changes"("id", "previous_final_status", "final_status")
      where "target"."id" = "changes"."id"
        and "target"."final_status" is not distinct from "changes"."previous_final_status"
    `))
  }
  if (!rowsAreAligned) {
    for (const change of getFinalStatusPersistenceChanges(sourceRows, preparedRows)) {
      pendingChanges.push(change)
      if (pendingChanges.length >= FINAL_STATUS_UPDATE_BATCH_SIZE) await flushChanges()
    }
    await flushChanges()
    return changeCount
  }

  for (let index = 0; index < sourceRows.length; index += 1) {
    const sourceRow = sourceRows[index]!
    const preparedRow = preparedRows[index]!
    const previousFinalStatus = sourceRow.finalStatus ?? null
    const finalStatus = preparedRow.finalStatus ?? null
    if (previousFinalStatus === finalStatus) continue
    pendingChanges.push({ id: sourceRow.id, previousFinalStatus, finalStatus })
    if (pendingChanges.length >= FINAL_STATUS_UPDATE_BATCH_SIZE) await flushChanges()
  }
  await flushChanges()
  return changeCount
}
