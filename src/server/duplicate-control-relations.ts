import { asc, inArray } from 'drizzle-orm'

import { requireDb } from '@/db'
import { duplicateControls } from '@/db/schema'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import { splitNumberBatches } from '@/server/weld-request-utils'

type DuplicateControlCarrier = {
  id: number
  duplicateControls?: DuplicateControlRecord[]
}

type DuplicateControlDb = Pick<ReturnType<typeof requireDb>, 'select'>

export async function attachDuplicateControlRelations<Row extends DuplicateControlCarrier>(
  rows: Row[],
  db: DuplicateControlDb = requireDb(),
) {
  if (rows.length === 0) return rows
  const rowIds = [...new Set(rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0))]
  if (rowIds.length === 0) return rows

  const records: Array<typeof duplicateControls.$inferSelect> = []
  for (const rowIdBatch of splitNumberBatches(rowIds, 1000)) {
    records.push(...await db
      .select()
      .from(duplicateControls)
      .where(inArray(duplicateControls.weldJointId, rowIdBatch))
      .orderBy(asc(duplicateControls.weldJointId), asc(duplicateControls.id)))
  }
  const byRowId = new Map<number, DuplicateControlRecord[]>()
  for (const record of records) {
    const current = byRowId.get(record.weldJointId) ?? []
    current.push({
      id: record.id,
      version: record.updatedAt?.toISOString?.() ?? '',
      weldJointId: record.weldJointId,
      method: record.method as DuplicateControlRecord['method'],
      result: record.result as DuplicateControlRecord['result'],
      controlDate: record.controlDate ?? '',
      conclusion: record.conclusion ?? '',
      conclusionDate: record.conclusionDate ?? '',
    })
    byRowId.set(record.weldJointId, current)
  }

  return rows.map((row) => ({ ...row, duplicateControls: byRowId.get(row.id) ?? [] }))
}
