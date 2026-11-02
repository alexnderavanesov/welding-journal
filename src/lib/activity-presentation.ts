import type { AuditFieldChange, AuditFieldOrigin, AuditValue } from './audit-value'
import { activityFieldLabel } from './activity-labels'

export type ActivityChange = AuditFieldChange
export type ActivityRecord = {
  id: number; entity: string; label: string; jointId: number | null;
  kind: 'create' | 'update' | 'delete'; changes: Record<string, ActivityChange>
}
export type PresentedChange = ActivityChange & { key: string; label: string; valueKey: string }

/** Partition stored field provenance only. Old/unrecognised markers stay neutral. */
export function splitActivityOrigins(rows: ActivityRecord[]) {
  const groups: Record<AuditFieldOrigin | 'unknown', ActivityRecord[]> = { user: [], automatic: [], unknown: [] }
  for (const row of rows) {
    if (!Object.keys(row.changes).length) { groups.unknown.push(row); continue }
    const changes: Record<keyof typeof groups, ActivityRecord['changes']> = { user: {}, automatic: {}, unknown: {} }
    for (const [field, change] of Object.entries(row.changes)) {
      const origin = change.origin === 'user' || change.origin === 'automatic' ? change.origin : 'unknown'
      // Known service-only fields stay stored but should not create an empty
      // automatic section merely because a new record received an internal ID.
      if (origin !== 'unknown' && row.entity !== 'generated_document_weld_joints' && isTechnicalActivityField(field)) continue
      changes[origin][field] = change
    }
    for (const origin of ['user', 'automatic', 'unknown'] as const) if (Object.keys(changes[origin]).length) groups[origin].push({ ...row, changes: changes[origin] })
  }
  return groups
}
const entityLabels: Record<string, string> = {
  weld_joints: 'Стык', generated_documents: 'Документ', generated_document_weld_joints: 'Связь документа со стыком',
  pre_heat_treatment_controls: 'НК до ТО', psto_repeat_cycles: 'Цикл ПСТО / ТВМТ', duplicate_controls: 'Дублирующий контроль',
  line_programs: 'Программа линии', psto_chain_exceptions: 'Исключение ПСТО', welder_stamps: 'Клеймо сварщика',
  welder_stamp_suspensions: 'Приостановка клейма', specialists: 'Специалист', technology_cards: 'Технологическая карта',
  technology_card_names: 'Название технологической карты', document_templates: 'Шаблон документа',
  dispatcher_accepted_warnings: 'Принятое исключение', app_settings: 'Настройки', account: 'Пользователь',
}
export const activityKindLabels = { create: 'Создание', update: 'Изменение', delete: 'Удаление' }
export function activityRecordTitle(row: ActivityRecord) {
  return [entityLabels[row.entity] ?? 'Запись', row.label.trim()].filter(Boolean).join(' · ')
}
const technicalKeys = new Set(['id', 'blobKey', 'fileData', 'fileDataBase64', 'metadata', 'constructorConfig', 'rowIds', 'relationId',
  'lineProgramId', 'documentId', 'technologyCardId', 'welderStampId', 'weldJointId', 'sha256'])
export function isTechnicalActivityField(key: string) { return technicalKeys.has(key) }
const metadataKeys = ['label', 'sourceKind', 'cycleSequences', 'methodCode', 'methodCodes', 'positionCount', 'projects', 'subtitleCodes', 'lines', 'periodFrom', 'periodTo', 'sourcePositions']

/** Display only saved history, never resolve old values against today's records. */
function metadata(value: AuditValue | undefined): Record<string, AuditValue> | undefined {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) as AuditValue } catch { return undefined }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}
function equal(a: AuditValue | undefined, b: AuditValue | undefined): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => equal(item, b[i]))
  const left = a as Record<string, AuditValue>, right = b as Record<string, AuditValue>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]))
}
function empty(value: AuditValue | undefined) { return value == null || value === '' || Array.isArray(value) && !value.length }
export function presentActivityChanges(row: ActivityRecord): PresentedChange[] {
  const result: PresentedChange[] = []
  const add = (key: string, valueKey: string, change: ActivityChange) => {
    if (row.kind === 'update' ? equal(change.before, change.after) : empty(row.kind === 'create' ? change.after : change.before)) return
    result.push({ key, valueKey, label: activityFieldLabel(row.entity, valueKey), ...change })
  }
  for (const [key, change] of Object.entries(row.changes)) {
    if (key === 'sourceMetadata') {
      const before = metadata(change.before), after = metadata(change.after)
      // An unreadable historical snapshot is not evidence of cleared fields.
      if (!empty(change.before) && !before || !empty(change.after) && !after) continue
      for (const field of metadataKeys) add(`sourceMetadata.${field}`, field, { before: before?.[field], after: after?.[field], ...(change.origin ? { origin: change.origin } : {}) })
    } else if (!technicalKeys.has(key) && activityFieldLabel(row.entity, key) !== key) add(key, key, change)
  }
  // Joint and document-position counts describe different things. Merge their
  // display only when BOTH saved sides agree, retaining both meanings in the
  // label. Diverging counts (e.g. several methods per joint) remain separate.
  const jointCount = result.find(change => change.valueKey === 'rowCount')
  const positionIndex = result.findIndex(change => change.valueKey === 'positionCount')
  if (jointCount && positionIndex >= 0) {
    const positionCount = result[positionIndex]
    if (equal(jointCount.before, positionCount.before) && equal(jointCount.after, positionCount.after)) {
      jointCount.label = 'Количество стыков и позиций'
      result.splice(positionIndex, 1)
    }
  }
  return result
}

/** Cheap search/summary for the current page: no parsing of large metadata or file snapshots. */
export function activityRecordFields(row: ActivityRecord) {
  const labels = Object.keys(row.changes).filter(key => !technicalKeys.has(key) && activityFieldLabel(row.entity, key) !== key)
    .map(key => activityFieldLabel(row.entity, key))
  return labels.length ? labels : ['Дополнительные сведения']
}

/** A position's identity can change without changing its count. Keep that fact
 * visible, but do not expose internal joint/relation IDs as a before/after list. */
export function activityPositionSummary(change: PresentedChange, kind: ActivityRecord['kind'], showCounts = true) {
  const before = Array.isArray(change.before) ? change.before.length : undefined
  const after = Array.isArray(change.after) ? change.after.length : undefined
  if (kind === 'create') return after === undefined ? 'Состав позиций документа сохранён.' : `Позиций в документе: ${after}.`
  if (kind === 'delete') return before === undefined ? 'Состав позиций документа удалён.' : `Позиций в удалённом документе: ${before}.`
  if (before === undefined || after === undefined) return 'Обновлены сведения о позициях документа.'
  return showCounts && before !== after
    ? `Состав позиций документа изменён. Количество: ${before} → ${after}.`
    : 'Состав позиций документа изменён.'
}
