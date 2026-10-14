import { getSpecialistDocumentProfile, normalizeSpecialistSelection, specialistMatches, type SpecialistRecord, type SpecialistSelection } from './document-specialists'

export const SPECIALIST_DEFAULTS_SETTING_KEY = 'document-specialist-defaults'
export const SPECIALIST_DEFAULT_KEYS = ['lnkConclusionVik', 'lnkConclusionRk', 'lnkConclusionPvk', 'lnkConclusionUzk', 'tvmtConclusion', 'pstoConclusion'] as const
export type SpecialistDefaults = Partial<Record<typeof SPECIALIST_DEFAULT_KEYS[number], SpecialistSelection>>

export function parseSpecialistDefaults(value?: string | null): SpecialistDefaults {
  try {
    const raw = JSON.parse(value || '{}'), result: SpecialistDefaults = {}
    for (const key of SPECIALIST_DEFAULT_KEYS) {
      if (!raw?.[key]) continue
      try { result[key] = normalizeSpecialistSelection(raw[key]) } catch { /* An invalid legacy preference is not an assignment. */ }
    }
    return result
  } catch { return {} }
}

export function availableSpecialistDefaults(defaults: SpecialistDefaults, records: readonly SpecialistRecord[]): SpecialistDefaults {
  const byId = new Map(records.map(record => [record.id, record]))
  return Object.fromEntries(Object.entries(defaults).map(([key, pair]) => [key, Object.fromEntries((['first', 'second'] as const).map(role => {
    const record = byId.get(pair[role] ?? 0)
    return [role, record && specialistMatches(record, getSpecialistDocumentProfile(key)!) ? record.id : null]
  }))]))
}
