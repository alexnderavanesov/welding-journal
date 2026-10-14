export const SPECIALIST_METHODS = ['ВИК', 'РК', 'ПВК', 'УЗК', 'ТВМТ'] as const
export type SpecialistMethod = typeof SPECIALIST_METHODS[number]
export type SpecialistKind = 'inspector' | 'thermist'
export type SpecialistRecord = {
  id: number
  name: string
  kind: SpecialistKind
  certificate: string
  methods: SpecialistMethod[]
  revision: number
  archived?: boolean
}
export type SpecialistSnapshot = Pick<SpecialistRecord, 'id' | 'name' | 'certificate'>
export type DocumentSpecialists = { first?: SpecialistSnapshot | null; second?: SpecialistSnapshot | null }
export type SpecialistSelection = { first?: number | null; second?: number | null }
export type SpecialistDraft = { common?: SpecialistSelection; documents?: Record<string, SpecialistSelection> }
export type SpecialistCreationAssignment = { title: string; selection: SpecialistSelection }
export type SpecialistDocumentProfile = { kind: SpecialistKind; methods: readonly string[]; labels: readonly [string, string] }

export function getSpecialistDocumentProfile(type: string, method?: string): SpecialistDocumentProfile | null {
  const id = type.replace(/^system:/, '')
  if (id === 'pstoConclusion') return { kind: 'thermist', methods: [], labels: ['Оператор-термист', 'Руководитель по ТО'] }
  const methods: Record<string, string> = {
    lnkConclusionVik: 'ВИК', lnkConclusionRk: 'РК', lnkConclusionPvk: 'ПВК', lnkConclusionUzk: 'УЗК', tvmtConclusion: 'ТВМТ',
    layeredVikEdges: 'ВИК', layeredVikLayers: 'ВИК', layeredPvkEdges: 'ПВК', layeredPvkLayers: 'ПВК',
  }
  const resolved = methods[id] ?? (id === 'lnkConclusion' ? method : undefined)
  return resolved && SPECIALIST_METHODS.includes(resolved as SpecialistMethod)
    ? { kind: 'inspector', methods: [resolved], labels: ['Провёл контроль', 'Выдал заключение'] } : null
}

export function specialistMatches(record: SpecialistRecord, profile: SpecialistDocumentProfile) {
  return !record.archived && record.kind === profile.kind && profile.methods.every(method => record.methods.includes(method as SpecialistMethod))
}

export function normalizeSpecialistSelection(value: SpecialistSelection | undefined): SpecialistSelection {
  const result: SpecialistSelection = {}
  for (const role of ['first', 'second'] as const) {
    const id = value?.[role]
    if (id === undefined) continue
    if (id !== null && (!Number.isSafeInteger(id) || id <= 0)) throw new Error('Некорректный специалист.')
    result[role] = id
  }
  return result
}

export function getDraftSpecialists(draft: SpecialistDraft | undefined, membership: string): SpecialistSelection {
  return { ...draft?.common, ...draft?.documents?.[membership] }
}

/** Compare each role's saved name/certificate, not registry IDs or today's card. A conflicting merge clears both roles. */
export function inheritDocumentSpecialists(snapshots: Array<DocumentSpecialists | null | undefined>) {
  const pair = (value: DocumentSpecialists | null | undefined): DocumentSpecialists => ({ first: value?.first ?? null, second: value?.second ?? null })
  const identity = (value: DocumentSpecialists) => JSON.stringify(['first', 'second'].map(role => {
    const person = value[role as keyof DocumentSpecialists]
    return person ? [person.name, person.certificate] : null
  }))
  const snapshot = pair(snapshots[0])
  const conflict = snapshots.some(value => identity(pair(value)) !== identity(snapshot))
  return { snapshot: conflict ? pair(null) : snapshot, conflict }
}

export function resolveDocumentSpecialists(current: DocumentSpecialists | null | undefined, selection: SpecialistSelection, records: Map<number, SpecialistRecord>, profile: SpecialistDocumentProfile): DocumentSpecialists {
  const result = { ...current }
  for (const role of ['first', 'second'] as const) {
    const id = selection[role]
    if (id === undefined) continue
    if (id === null) { result[role] = null; continue }
    const record = records.get(id)
    if (!record || !specialistMatches(record, profile)) throw new Error(`Специалист не найден, архивирован или не имеет допуска для роли «${profile.labels[role === 'first' ? 0 : 1]}» (${profile.methods.join(', ') || 'ПСТО'}). Обновите выбор.`)
    result[role] = { id: record.id, name: record.name, certificate: record.certificate }
  }
  return result
}

export const SPECIALIST_TEMPLATE_FIELDS = [
  { key: '__controlPerformedName', label: 'Провёл контроль — ФИО', role: 'first', value: 'name', kind: 'inspector' },
  { key: '__controlPerformedCertificate', label: 'Провёл контроль — № удостоверения', role: 'first', value: 'certificate', kind: 'inspector' },
  { key: '__conclusionIssuedName', label: 'Выдал заключение — ФИО', role: 'second', value: 'name', kind: 'inspector' },
  { key: '__conclusionIssuedCertificate', label: 'Выдал заключение — № удостоверения', role: 'second', value: 'certificate', kind: 'inspector' },
  { key: '__thermistOperatorName', label: 'Оператор-термист — ФИО', role: 'first', value: 'name', kind: 'thermist' },
  { key: '__thermistOperatorCertificate', label: 'Оператор-термист — № удостоверения', role: 'first', value: 'certificate', kind: 'thermist' },
  { key: '__heatTreatmentSupervisorName', label: 'Руководитель по ТО — ФИО', role: 'second', value: 'name', kind: 'thermist' },
  { key: '__heatTreatmentSupervisorCertificate', label: 'Руководитель по ТО — № удостоверения', role: 'second', value: 'certificate', kind: 'thermist' },
] as const
export type SpecialistTemplateFieldKey = typeof SPECIALIST_TEMPLATE_FIELDS[number]['key']
export function isSpecialistTemplateField(key: string): key is SpecialistTemplateFieldKey {
  return SPECIALIST_TEMPLATE_FIELDS.some(field => field.key === key)
}

export function getSpecialistTemplateFields(type: string, method?: string) {
  const profile = getSpecialistDocumentProfile(type, method)
  return SPECIALIST_TEMPLATE_FIELDS.filter(field => field.kind === profile?.kind)
}

export function getSpecialistTemplateValue(key: string, snapshot: DocumentSpecialists | null | undefined, type: string, method?: string): string | undefined {
  const field = SPECIALIST_TEMPLATE_FIELDS.find(field => field.key === key)
  if (!field) return undefined
  if (field.kind !== getSpecialistDocumentProfile(type, method)?.kind) return ''
  return snapshot?.[field.role]?.[field.value] ?? ''
}
