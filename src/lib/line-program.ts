import type { WeldInput } from '@/lib/weld-fields'
import { encodeIdentityKey } from '@/lib/identity-key'
import { parseLineProgramPercent } from '@/lib/line-program-calculation'

export type LineProgramIdentity = { projectTitle: string; subtitleCode: string; line: string }
export type LineProgramProperties = {
  category: string | null
  groupName: string | null
  weldControlPercent: number | null
  pvkControlPercent: number | null
}
export type LineProgramRecord = LineProgramIdentity & LineProgramProperties & {
  id: number
  configurationIssue: string | null
  version: string
}
export type LineProgramTab = 'lines' | 'full' | 'percentage'
export type LineProgramListRequest = { tab?: LineProgramTab; search?: string; page?: number; pageSize?: number }
export type LineProgramSaveRequest = LineProgramIdentity & LineProgramProperties & { id?: number; version?: string }

export function normalizeLineProgramIdentity(row: Pick<WeldInput, 'projectTitle' | 'subtitleCode' | 'line'>): LineProgramIdentity {
  return { projectTitle: String(row.projectTitle ?? '').trim(), subtitleCode: String(row.subtitleCode ?? '').trim(), line: String(row.line ?? '').trim() }
}
export function getLineProgramIdentityKey(row: Pick<WeldInput, 'projectTitle' | 'subtitleCode' | 'line'>) {
  const identity = normalizeLineProgramIdentity(row)
  return encodeIdentityKey([identity.projectTitle, identity.subtitleCode, identity.line].map((s) => s.toLocaleLowerCase('ru')))
}
/** Case-only edits still update the displayed names throughout the line. */
export function hasLineProgramIdentityChanges(previous: LineProgramIdentity, next: LineProgramIdentity) {
  return (['projectTitle', 'subtitleCode', 'line'] as const).some((key) => previous[key].trim() !== next[key].trim())
}
export function getLineProgramConfigurationIssue(record: LineProgramProperties) {
  const missing = [!record.category?.trim() && 'категория', !record.groupName?.trim() && 'группа',
    record.weldControlPercent == null && 'базовый процент', record.pvkControlPercent == null && 'процент ПВК'].filter(Boolean)
  return missing.length ? `СП-02: не настроены ${missing.join(', ')}.` : null
}
export function normalizeLineProgramSaveRequest(data: LineProgramSaveRequest): LineProgramSaveRequest {
  if (!data || (data.id != null && (!Number.isSafeInteger(data.id) || data.id <= 0 || !data.version))) throw new Error('Обновите программу линии: отсутствует корректная версия записи.')
  const identity = normalizeLineProgramIdentity(data)
  if (!identity.line) throw new Error('Укажите линию.')
  const readPercent = (value: unknown, label: string) => {
    if (value == null || String(value).trim() === '') return null
    const percent = parseLineProgramPercent(value)
    if (percent === null || percent !== Math.round(percent * 1000) / 1000) {
      throw new Error(`${label}: укажите число от 0 до 100, не более трёх знаков после запятой.`)
    }
    return percent
  }
  const weldControlPercent = readPercent(data.weldControlPercent, 'Базовый процент')
  const pvkControlPercent = readPercent(data.pvkControlPercent, 'Процент ПВК')
  if (weldControlPercent != null && pvkControlPercent != null &&
      (weldControlPercent === 100 ? pvkControlPercent < 1 : pvkControlPercent > weldControlPercent)) {
    throw new Error(weldControlPercent === 100 ? 'При базовых 100% процент ПВК должен быть от 1 до 100.' :
      'Процент ПВК не должен превышать базовый процент линии.')
  }
  return { ...identity, id: data.id, version: data.version,
    category: String(data.category ?? '').trim() || null, groupName: String(data.groupName ?? '').trim() || null,
    weldControlPercent, pvkControlPercent }
}

/** Pure validation, shared by imports and interactive writes. All conflicting fields are retained. */
export function getLineProgramMetadataConflicts(record: WeldInput, line: LineProgramProperties, previous?: WeldInput) {
  return (['category', 'groupName', 'weldControlPercent'] as const).filter((field) => {
    const supplied = record[field]
    if (supplied == null || String(supplied).trim() === '') return false
    if (previous && getLineProgramIdentityKey(previous) !== getLineProgramIdentityKey(record) &&
      String(supplied).trim() === String(previous[field] ?? '').trim()) return false
    const expected = line[field]
    if (expected == null) return false
    return field === 'weldControlPercent' ? parseLineProgramPercent(supplied) !== expected :
      String(supplied).trim().toLocaleLowerCase('ru') !== String(expected).trim().toLocaleLowerCase('ru')
  })
}
