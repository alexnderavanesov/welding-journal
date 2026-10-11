import { buildSystemDocumentSplitGroups, SYSTEM_DOCUMENT_SPLIT_MODES, SYSTEM_DOCUMENT_SPLIT_SETTING_IDS, type SystemDocumentSplitMode, type SystemDocumentSplitSettingId, type SystemDocumentSplitRow } from './system-document-splitting'
import type { SystemDocumentCreationGroup } from './system-document-creation-plan'

export type DocumentGroupingCommand = { settingId: SystemDocumentSplitSettingId; mode: SystemDocumentSplitMode }

export function normalizeDocumentGroupingCommand(value: DocumentGroupingCommand | undefined): DocumentGroupingCommand | undefined {
  if (value === undefined) return undefined
  if (!value || !SYSTEM_DOCUMENT_SPLIT_SETTING_IDS.includes(value.settingId) || !SYSTEM_DOCUMENT_SPLIT_MODES.includes(value.mode)) {
    throw new Error('Некорректный вариант разделения документов.')
  }
  return { settingId: value.settingId, mode: value.mode }
}

export function getCreationGroupingCommand(groups: readonly SystemDocumentCreationGroup[]): DocumentGroupingCommand | undefined {
  const group = groups[0]
  return group?.splitSettingId && group.splitMode ? { settingId: group.splitSettingId, mode: group.splitMode } : undefined
}

/** Validate the full server-side composition; the UI's grouping is not an authority. */
export function assertCreationGrouping<Row extends SystemDocumentSplitRow>(groups: Array<{ rows: Row[]; name: string }>, mode: SystemDocumentSplitMode) {
  const allRows = groups.flatMap(group => group.rows)
  if (new Set(allRows.map(row => row.id)).size !== allRows.length) throw new Error('Стык включён в несколько создаваемых документов.')
  const expected = buildSystemDocumentSplitGroups(allRows, mode)
  if (expected.some(group => group.isMissingValueFallback)) throw new Error('Заполните поля, необходимые для выбранного разделения.')
  const membership = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',')
  const actual = new Set(groups.map(group => membership(group.rows.map(row => row.id))))
  if (actual.size !== expected.length || expected.some(group => !actual.has(membership(group.rowIds)))) {
    throw new Error('Состав документов не соответствует выбранному разделению. Обновите предпросмотр.')
  }
  // Whether a conclusion name is required belongs to the workflow's save
  // settings. Empty names create no documents and cannot collide with each other.
  const names = groups.map(group => group.name.trim().toLocaleLowerCase('ru')).filter(Boolean)
  if (new Set(names).size !== names.length) throw new Error('Названия создаваемых документов должны различаться.')
}
