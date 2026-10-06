import { weldJoints } from '@/db/schema'
import { getSystemIndexValidationError, normalizeSystemIndexSettings, type SystemIndexKey, type SystemIndexSettings } from '@/lib/system-index-settings'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

const letters: readonly SystemIndexKey[] = ['shopJoint', 'fieldJoint', 'repair', 'cutout', 'coil']

/** Caller holds the exclusive weld-validation settings lock. Weld creation takes
 * its shared counterpart, so the first joint cannot appear between check/save. */
export async function prepareSystemIndexSettingsChange(
  tx: Pick<SystemDocumentSequenceTransaction, 'select'>, currentValue: unknown, nextValue: unknown,
) {
  const source = nextValue && typeof nextValue === 'object' ? nextValue as Record<string, unknown> : {}
  const next = { ...Object.fromEntries(letters.map(key => [key, String(source[key] ?? '').trim().toUpperCase()])),
    allowLeadingLetterIndex: source.allowLeadingLetterIndex === true } as SystemIndexSettings
  const error = getSystemIndexValidationError(next)
  if (error) throw new Error(error)
  const current = normalizeSystemIndexSettings(currentValue)
  if (letters.some(key => current[key] !== next[key])) {
    // Existence, not COUNT or a journal load. Unofficial/inactive rows also keep
    // their historical names. The separate leading-letter option stays editable.
    const existing = await tx.select({ id: weldJoints.id }).from(weldJoints).limit(1)
    if (existing.length) throw new Error('Буквы системных индексов можно менять только пока в проекте нет стыков. Обновите настройки; сохранённые цепочки не изменены.')
  }
  return next
}
