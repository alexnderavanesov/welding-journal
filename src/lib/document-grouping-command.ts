import { buildSystemDocumentSplitGroups, SYSTEM_DOCUMENT_SPLIT_MODES, SYSTEM_DOCUMENT_SPLIT_SETTING_IDS, type SystemDocumentSplitMode, type SystemDocumentSplitSettingId, type SystemDocumentSplitRow } from './system-document-splitting'
import type { SystemDocumentCreationGroup } from './system-document-creation-plan'
import { getSpecialistDocumentProfile, normalizeSpecialistSelection, type SpecialistCreationAssignment, type SpecialistSelection } from './document-specialists'

export type DocumentGroupingCommand = { settingId: SystemDocumentSplitSettingId; mode: SystemDocumentSplitMode; specialists?: SpecialistCreationAssignment[]; specialistDefaults?: SpecialistSelection }

export function normalizeDocumentGroupingCommand(value: DocumentGroupingCommand | undefined): DocumentGroupingCommand | undefined {
  if (value === undefined) return undefined
  if (!value || !SYSTEM_DOCUMENT_SPLIT_SETTING_IDS.includes(value.settingId) || !SYSTEM_DOCUMENT_SPLIT_MODES.includes(value.mode)) {
    throw new Error('Некорректный вариант разделения документов.')
  }
  if (value.specialists && (!Array.isArray(value.specialists) || value.specialists.length > 10000)) throw new Error('Некорректные назначения специалистов.')
  if (value.specialistDefaults && !getSpecialistDocumentProfile(value.settingId)) throw new Error('Этот документ не поддерживает специалистов.')
  return { settingId: value.settingId, mode: value.mode, ...(value.specialistDefaults ? { specialistDefaults: normalizeSpecialistSelection(value.specialistDefaults) } : {}), ...(value.specialists?.length ? { specialists: value.specialists.map(item => ({ title: String(item.title ?? '').trim(), selection: normalizeSpecialistSelection(item.selection) })) } : {}) }
}

export function getCreationGroupingCommand(groups: readonly SystemDocumentCreationGroup[]): DocumentGroupingCommand | undefined {
  const group = groups[0]
  const specialists = groups.flatMap(item => item.specialists && Object.values(item.specialists).some(id => typeof id === 'number') ? [{ title: item.name, selection: item.specialists }] : [])
  return group?.splitSettingId && group.splitMode ? { settingId: group.splitSettingId, mode: group.splitMode, ...(group.specialistDefaults ? { specialistDefaults: group.specialistDefaults } : {}), ...(specialists.length ? { specialists } : {}) } : undefined
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
  const names = groups.map(group => group.name.trim().toLocaleLowerCase('ru'))
  if (names.some(name => !name)) throw new Error('Укажите название для каждого создаваемого документа.')
  if (new Set(names).size !== names.length) throw new Error('Названия создаваемых документов должны различаться.')
}
