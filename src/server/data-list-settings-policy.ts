import { eq, inArray } from 'drizzle-orm'
import { appSettings, weldJoints, workClosures } from '@/db/schema'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { testClosureKey } from '@/lib/work-closures'
import { normalizeDataListSettings, prepareDataListSettingsChange } from '@/lib/data-list-settings'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { normalizedConnectionTypeSql } from './connection-type-sql'

export async function readServerDataLists(tx: Pick<SystemDocumentSequenceTransaction, 'select'>) {
  const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, PROJECT_SETTING_KEYS.dataList)).limit(1)
  return normalizeDataListSettings(row ? JSON.parse(row.value) : undefined)
}

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
  const retainedTests = new Set(next.testTypes)
  const removedTests = previous.testTypes.filter(name => !retainedTests.has(name)).map(testClosureKey)
  if (removedTests.length) {
    const [used] = await tx.select({ value: workClosures.workType }).from(workClosures)
      .where(inArray(workClosures.workType, removedTests)).limit(1)
    if (used) throw new Error(`Нельзя удалить вид испытаний «${previous.testTypes.find(name => testClosureKey(name) === used.value)}»: он используется в закрытии работ.`)
  }
  return next
}
