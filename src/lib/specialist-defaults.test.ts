import { describe, expect, it } from 'vitest'
import { availableSpecialistDefaults, parseSpecialistDefaults, SPECIALIST_DEFAULT_KEYS } from './specialist-defaults'
import { getCreationGroupingCommand, normalizeDocumentGroupingCommand } from './document-grouping-command'
import { buildSystemDocumentCreationPlan } from './system-document-creation-plan'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from './request-conclusion-settings'
import type { WeldRow } from './dispatcher-types'
import { hydrateSpecialistNaming } from '@/components/system-document-split-control'

describe('remembered common specialist pairs', () => {
  it('omits expired defaults on the conclusion date and leaves explicit edits visible for validation', () => {
    const record = { id: 1, name: 'Иванов', certificate: '2025', kind: 'inspector' as const, methods: ['ВИК' as const], revision: 1,
      certificates: [{ number: '2025', validFrom: '2025-01-01', validTo: '2025-12-31', methods: ['ВИК' as const] }] }
    const naming = { mode: 'system' as const, customName: '', specialistDefaults: { lnkConclusionVik: { first: 1, second: 1 } }, specialistDefaultRecords: [record] }
    expect(hydrateSpecialistNaming(naming, 'lnkConclusionVik', '')).toBe(naming)
    expect(hydrateSpecialistNaming(naming, 'lnkConclusionVik', '2025-12-31').specialists?.common).toEqual({ first: 1, second: 1 })
    const expired = hydrateSpecialistNaming(naming, 'lnkConclusionVik', '2026-01-01')
    expect(expired.specialists?.common).toEqual({ first: null, second: null })
    const edited = { ...expired, specialists: { common: { first: 1 } } }
    expect(hydrateSpecialistNaming(edited, 'lnkConclusionVik', '2026-02-01')).toBe(edited)
  })
  it('bounds preferences to six methods and removes archived, missing or no longer qualified people per role', () => {
    const raw = Object.fromEntries([...SPECIALIST_DEFAULT_KEYS, 'lnkRequest', 'injected'].map(key => [key, { first: 1, second: 2 }]))
    const defaults = parseSpecialistDefaults(JSON.stringify(raw))
    expect(Object.keys(defaults)).toHaveLength(6)
    const card = { id: 1, name: 'A', certificate: '1', kind: 'inspector' as const, methods: ['ВИК' as const, 'ТВМТ' as const], revision: 1 }
    const filtered = availableSpecialistDefaults(defaults, [card, { ...card, id: 2, archived: true }])
    expect(filtered.lnkConclusionVik).toEqual({ first: 1, second: null })
    expect(filtered.tvmtConclusion).toEqual({ first: 1, second: null })
    expect(filtered.lnkConclusionRk).toEqual({ first: null, second: null })
    expect(filtered.pstoConclusion).toEqual({ first: null, second: null })
    expect(parseSpecialistDefaults('{')).toEqual({})
    expect(parseSpecialistDefaults('{"lnkConclusionVik":{"first":-1}}')).toEqual({})
  })
  it('hydrates before opening the specialists tab, switches methods and preserves edits on a same-method refresh', () => {
    const naming = { mode: 'system' as const, customName: '', specialistDefaults: { lnkConclusionVik: { first: 1, second: 2 }, lnkConclusionRk: { first: 3, second: null } } }
    const vik = hydrateSpecialistNaming(naming, 'lnkConclusionVik')
    expect(vik.specialists?.common).toEqual({ first: 1, second: 2 })
    const edited = { ...vik, specialists: { common: { first: null, second: 4 }, documents: { d: { first: 5 } } } }
    expect(hydrateSpecialistNaming(edited, 'lnkConclusionVik')).toBe(edited)
    expect(hydrateSpecialistNaming(edited, 'lnkConclusionRk').specialists).toEqual({ common: { first: 3, second: null } })
    expect(hydrateSpecialistNaming(naming, 'lnkRequest')).toBe(naming)
  })
  it('remembers the common pair, not individual exceptions, including an explicitly empty pair', () => {
    for (const common of [{ first: 1, second: 2 }, { first: null, second: null }]) {
      const plan = buildSystemDocumentCreationPlan({ type: 'lnkConclusion', methodCode: 'ВИК', date: '2026-10-13', rows: [{ id: 1 } as WeldRow], naming: { mode: 'system', customName: '', specialists: { common } }, settings: REQUEST_CONCLUSION_DEFAULT_SETTINGS })
      plan.groups[0].specialists = { first: 99, second: null }
      expect(normalizeDocumentGroupingCommand(getCreationGroupingCommand(plan.groups))?.specialistDefaults).toEqual(common)
    }
    expect(() => normalizeDocumentGroupingCommand({ settingId: 'lnkRequest', mode: 'none', specialistDefaults: { first: 1 } })).toThrow('не поддерживает')
  })
})
