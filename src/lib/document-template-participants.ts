import type { DocumentTemplateConstructorConfig } from './document-template-model'
import type { WelderStampRecord } from './welder-stamp-types'
import type { SpecialistSnapshot } from './document-specialists'

export const PARTICIPANT_KINDS = ['welder', 'thermist', 'inspector'] as const
export type ParticipantKind = typeof PARTICIPANT_KINDS[number]
export const PARTICIPANT_LABELS: Record<ParticipantKind, string> = { welder: 'Сварщик', thermist: 'Оператор-термист', inspector: 'Дефектоскопист' }
export const PARTICIPANT_CATEGORY_LABELS: Record<ParticipantKind, string> = { welder: 'Сварщики', thermist: 'Операторы-термисты', inspector: 'Дефектоскописты' }
export type TemplateParticipant = { key: string; kind: ParticipantKind; name: string; certificate: string; stamp: string; internalStamp: string }
export const PARTICIPANT_FIELDS = [
  { key: '__participantName', label: 'ФИО участника' },
  { key: '__participantKind', label: 'Специальность' },
  { key: '__participantCertificate', label: '№ удостоверения' },
  { key: '__participantStamp', label: 'Клеймо НАКС' },
  { key: '__participantInternalStamp', label: 'Внутреннее клеймо' },
] as const
export type ParticipantFieldKey = typeof PARTICIPANT_FIELDS[number]['key']
export const isParticipantField = (field: unknown): field is ParticipantFieldKey => PARTICIPANT_FIELDS.some(item => item.key === field)
export const normalizeParticipantKinds = (value: unknown): ParticipantKind[] => value === undefined ? [...PARTICIPANT_KINDS]
  : PARTICIPANT_KINDS.filter(kind => Array.isArray(value) && value.includes(kind))

export function getParticipantValue(field: ParticipantFieldKey, person?: TemplateParticipant): string {
  if (!person) return ''
  return field === '__participantKind' ? PARTICIPANT_LABELS[person.kind]
    : field === '__participantName' ? person.name : field === '__participantCertificate' ? person.certificate
      : field === '__participantStamp' ? person.stamp : person.internalStamp
}

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('ru-RU')
export function buildWelderParticipants(stamps: string[], registry: Pick<WelderStampRecord, 'id' | 'welderName' | 'naksStamp' | 'internalStamp'>[]): TemplateParticipant[] {
  // Same alias precedence as the existing official-stamp name lookup. Include
  // archived cards: archiving a person must not erase their completed work.
  const byStamp = new Map<string, typeof registry[number]>()
  const sorted = [...registry].sort((a, b) => a.id - b.id)
  for (const field of ['naksStamp', 'internalStamp'] as const) for (const person of sorted) {
    const key = normalize(person[field])
    if (key && !byStamp.has(key)) byStamp.set(key, person)
  }
  const result = new Map<string, TemplateParticipant>()
  for (const stamp of stamps) {
    const code = normalize(stamp)
    if (!code) continue
    const person = byStamp.get(code), key = person ? `welder:${person.id}` : `welder:missing:${code}`
    result.set(key, { key, kind: 'welder', name: person?.welderName.trim() ?? '', certificate: '',
      stamp: person?.naksStamp.trim() || stamp.trim(), internalStamp: person?.internalStamp.trim() ?? '' })
  }
  return [...result.values()]
}

export function buildSpecialistParticipant(kind: 'thermist' | 'inspector', snapshot: SpecialistSnapshot | null | undefined): TemplateParticipant | null {
  if (!snapshot?.name?.trim()) return null
  const name = snapshot.name.trim(), certificate = String(snapshot.certificate ?? '').trim()
  // Keep different certificates/names from historical assignments separate;
  // matching names alone are never sufficient to collapse two people.
  return { key: JSON.stringify([kind, snapshot.id, normalize(name), normalize(certificate)]), kind, name, certificate, stamp: '', internalStamp: '' }
}

export function sortUniqueParticipants(people: TemplateParticipant[]) {
  return [...new Map(people.map(person => [person.key, person])).values()].sort((a, b) =>
    PARTICIPANT_KINDS.indexOf(a.kind) - PARTICIPANT_KINDS.indexOf(b.kind)
    || a.name.localeCompare(b.name, 'ru', { numeric: true, sensitivity: 'base' })
    || a.certificate.localeCompare(b.certificate, 'ru', { numeric: true }) || a.key.localeCompare(b.key))
}

export function getParticipantTemplateIssues(config: DocumentTemplateConstructorConfig) {
  const issues: Array<{ cell?: string; message: string }> = []
  if (config.repeatMode === 'participants' && !normalizeParticipantKinds(config.participantKinds).length) {
    issues.push({ message: 'Выберите хотя бы одну категорию участников работ.' })
  }
  if (config.repeatMode === 'participants' && !config.bindings.some(binding => binding.mode === 'row')) {
    issues.push({ message: 'Назначьте поля в повторяемой строке списка участников.' })
  }
  for (const binding of config.bindings) {
    const fields = (binding.parts?.length ? binding.parts : binding.field ? [{ field: binding.field }] : [])
      .flatMap(part => [part.field, 'compareField' in part ? part.compareField : undefined]).filter(Boolean)
    if (fields.some(isParticipantField) && (config.repeatMode !== 'participants' || binding.mode !== 'row')) {
      issues.push({ cell: binding.cell, message: `В ячейке ${binding.cell}: поля участника доступны в повторяемой строке режима «По участникам работ».` })
    }
    if (config.repeatMode === 'participants' && binding.mode === 'row' && fields.some(field => field !== '__index' && !isParticipantField(field))) {
      issues.push({ cell: binding.cell, message: `В ячейке ${binding.cell}: выберите поле участника или № п/п. Данные стыков разместите в сводных ячейках вне повторяемого блока.` })
    }
  }
  return issues
}
