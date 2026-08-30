import { asc, inArray } from 'drizzle-orm'

import { requireDb } from '@/db'
import { duplicateControls } from '@/db/schema'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'

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

  const records = await db
    .select()
    .from(duplicateControls)
    .where(inArray(duplicateControls.weldJointId, rowIds))
    .orderBy(asc(duplicateControls.weldJointId), asc(duplicateControls.id))
  const byRowId = new Map<number, DuplicateControlRecord[]>()
  for (const record of records) {
    const current = byRowId.get(record.weldJointId) ?? []
    current.push(record as unknown as DuplicateControlRecord)
    byRowId.set(record.weldJointId, current)
  }

  return rows.map((row) => ({ ...row, duplicateControls: byRowId.get(row.id) ?? [] }))
}
