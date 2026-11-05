import { inArray } from 'drizzle-orm'
import { linePrograms } from '@/db/schema'
import { isTConnectionType } from '@/lib/connection-type'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

/** One bounded lookup per working set; never copy mutable percentages into weld storage. */
export async function attachSupportProgramRates<T extends WeldRow>(rows: T[], db: Pick<SystemDocumentSequenceTransaction, 'select'>): Promise<T[]> {
  const ids = [...new Set(rows.filter(row => isTConnectionType(row.connectionType) && row.lineProgramId != null).map(row => row.lineProgramId!))]
  if (!ids.length) return rows
  const byId = new Map<number, { supportUzkControlPercent: number | null; supportPvkControlPercent: number | null }>()
  for (let offset = 0; offset < ids.length; offset += 1000) {
    const programs = await db.select({ id: linePrograms.id, supportUzkControlPercent: linePrograms.supportUzkControlPercent, supportPvkControlPercent: linePrograms.supportPvkControlPercent })
      .from(linePrograms).where(inArray(linePrograms.id, ids.slice(offset, offset + 1000)))
    for (const program of programs) byId.set(program.id, program)
  }
  for (const row of rows) if (isTConnectionType(row.connectionType)) {
    const program = byId.get(row.lineProgramId ?? -1)
    row.supportUzkControlPercent = program?.supportUzkControlPercent ?? null
    row.supportPvkControlPercent = program?.supportPvkControlPercent ?? null
  }
  return rows
}
