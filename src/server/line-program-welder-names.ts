import { asc, sql } from 'drizzle-orm'
import { welderStamps } from '@/db/schema'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildTextArrayMatch } from './weld-request-utils'

/** Only the opened line's official stamps, in one query (including historical registry entries). */
export async function loadLineProgramWelderNames(db: Pick<SystemDocumentSequenceTransaction, 'select'>, stamps: string[]) {
  const keys = [...new Set(stamps.map(stamp => stamp.trim().toUpperCase()).filter(Boolean))]
  const names = new Map<string, string>()
  if (!keys.length) return names
  const records = await db.select({ stamp: welderStamps.naksStamp, name: welderStamps.welderName }).from(welderStamps)
    .where(buildTextArrayMatch(sql`upper(btrim(${welderStamps.naksStamp}))`, keys)).orderBy(asc(welderStamps.id))
  for (const record of records) {
    const key = record.stamp?.trim().toUpperCase(), name = record.name?.trim()
    if (key && name && !names.has(key)) names.set(key, name)
  }
  return names
}
