import { inArray } from 'drizzle-orm'
import { weldJoints } from '@/db/schema'
import { normalizeDataListSettings, prepareDataListSettingsChange } from '@/lib/data-list-settings'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { normalizedConnectionTypeSql } from './connection-type-sql'

/** Caller holds the exclusive weld-validation settings lock. Joint saves take
 * its shared counterpart, so a new usage cannot appear between check and save. */
export async function prepareDataListSettingsChangeInTransaction(
  tx: Pick<SystemDocumentSequenceTransaction, 'select'>, previousValue: unknown, nextValue: unknown,
) {
  const previous = normalizeDataListSettings(previousValue)
  const next = prepareDataListSettingsChange(previousValue, nextValue)
  const remaining = new Set(next.connectionTypes)
  const removed = previous.connectionTypes.filter(value => !remaining.has(value))
  if (removed.length) {
    const normalizedType = normalizedConnectionTypeSql(weldJoints.connectionType)
    // One bounded result, including unofficial/inactive/history records. A card
    // alone is not a weld and does not prohibit removing its type from the list.
    const [used] = await tx.select({ value: normalizedType }).from(weldJoints).where(inArray(normalizedType, removed)).limit(1)
    if (used) throw new Error(`Нельзя удалить тип соединения «${used.value}»: он используется в стыках. Обновите настройки.`)
  }
  return next
}
