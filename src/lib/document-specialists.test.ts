import { describe, expect, it } from 'vitest'
import { buildSystemDocumentCreationPlan } from './system-document-creation-plan'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from './request-conclusion-settings'
import { getCreationGroupingCommand, normalizeDocumentGroupingCommand } from './document-grouping-command'
import type { WeldRow } from './dispatcher-types'
import { SPECIALIST_TEMPLATE_FIELDS, getDraftSpecialists, getSpecialistDocumentProfile, getSpecialistTemplateFields, getSpecialistTemplateValue, inheritDocumentSpecialists, normalizeSpecialistSelection, resolveDocumentSpecialists, type SpecialistRecord } from './document-specialists'

const ivan: SpecialistRecord = { id: 1, name: 'Иванов', certificate: '123', kind: 'inspector', methods: ['ВИК', 'ТВМТ'], revision: 1 }
const petr: SpecialistRecord = { id: 2, name: 'Петров', certificate: '456', kind: 'thermist', methods: [], revision: 1 }
const records = new Map([ivan, petr].map(record => [record.id, record]))
const profile = getSpecialistDocumentProfile('lnkConclusion', 'ВИК')!

describe('document specialists requirements', () => {
  it('archive blocks new assignments but never clears historical signers', () => {
    const snapshot = resolveDocumentSpecialists(null, { first: 1, second: 1 }, records, profile)
    const archived = new Map([[1, { ...ivan, archived: true }]])
    expect(resolveDocumentSpecialists(snapshot, {}, archived, profile)).toEqual(snapshot)
    expect(resolveDocumentSpecialists(snapshot, { first: null }, archived, profile)).toEqual({ first: null, second: snapshot.second })
    for (const role of ['first', 'second'] as const) expect(() => resolveDocumentSpecialists(snapshot, { [role]: 1 }, archived, profile)).toThrow('архивирован')
  })
  it('inherits exact saved facts for split/rename and equal merges; clears both roles for any conflict', () => {
    const snapshot = { first: { id: 1, name: 'Иванов', certificate: 'старое' }, second: null }
    expect(inheritDocumentSpecialists([snapshot])).toEqual({ snapshot, conflict: false })
    expect(inheritDocumentSpecialists([snapshot, structuredClone(snapshot)])).toEqual({ snapshot, conflict: false })
    expect(inheritDocumentSpecialists([undefined, {}, null])).toEqual({ snapshot: { first: null, second: null }, conflict: false })
    for (const other of [null, { ...snapshot, first: { ...snapshot.first, certificate: 'новое' } }, { ...snapshot, second: snapshot.first }]) {
      expect(inheritDocumentSpecialists([snapshot, other])).toEqual({ snapshot: { first: null, second: null }, conflict: true })
    }
  })
  it('keeps existing and generated layered documents unassigned until explicitly chosen', () => {
    expect(getDraftSpecialists(undefined, 'doc')).toEqual({})
    expect(resolveDocumentSpecialists(null, {}, records, profile)).toEqual({})
  })
  it('permits either role empty and the same person in both roles', () => {
    const snapshot = resolveDocumentSpecialists(null, { first: 1, second: 1 }, records, profile)
    expect(snapshot.first).toEqual({ id: 1, name: 'Иванов', certificate: '123' })
    expect(snapshot.second).toEqual(snapshot.first)
    expect(resolveDocumentSpecialists(null, { second: 1 }, records, profile).first).toBeUndefined()
  })
  it('preserves snapshots on card edit and refreshes only an explicitly selected role', () => {
    const snapshot = resolveDocumentSpecialists(null, { first: 1, second: 1 }, records, profile)
    const changed = new Map([[1, { ...ivan, name: 'Иванов новый', certificate: '789', revision: 2 }]])
    expect(resolveDocumentSpecialists(snapshot, {}, changed, profile)).toEqual(snapshot)
    expect(resolveDocumentSpecialists(snapshot, { first: 1 }, changed, profile)).toEqual({ first: { id: 1, name: 'Иванов новый', certificate: '789' }, second: snapshot.second })
    expect(snapshot.first?.certificate).toBe('123')
  })
  it('clears FIO and certificate together without touching the other role or registry card', () => {
    const snapshot = resolveDocumentSpecialists(null, { first: 1, second: 1 }, records, profile)
    expect(resolveDocumentSpecialists(snapshot, { first: null }, records, profile)).toEqual({ first: null, second: snapshot.second })
    expect(records.get(1)).toEqual(ivan)
  })
  it('rejects wrong kinds, missing people and missing methods for BOTH roles', () => {
    for (const role of ['first', 'second'] as const) {
      expect(() => resolveDocumentSpecialists(null, { [role]: 2 }, records, profile)).toThrow('допуска')
      expect(() => resolveDocumentSpecialists(null, { [role]: 1 }, records, getSpecialistDocumentProfile('pstoConclusion')!)).toThrow('допуска')
      expect(() => resolveDocumentSpecialists(null, { [role]: 1 }, records, getSpecialistDocumentProfile('lnkConclusion', 'РК')!)).toThrow('допуска')
      expect(() => resolveDocumentSpecialists(null, { [role]: 999 }, records, profile)).toThrow('не найден')
    }
    expect(resolveDocumentSpecialists(null, { first: 2, second: 2 }, records, getSpecialistDocumentProfile('system:pstoConclusion')!).first?.name).toBe('Петров')
  })
  it.each(['lnkRequest', 'tvmtRequest', 'pstoRequest', 'weldingJournal', 'checklist', 'zni'])('excludes %s', type => {
    expect(getSpecialistDocumentProfile(type)).toBeNull()
    expect(getSpecialistTemplateFields(type)).toHaveLength(0)
  })
  it.each(['layeredVikEdges', 'layeredVikLayers', 'layeredPvkEdges', 'layeredPvkLayers', 'tvmtConclusion'])('allows the relevant inspector methods for %s', type => {
    expect(getSpecialistDocumentProfile(type)?.kind).toBe('inspector')
    expect(getSpecialistTemplateFields(type)).toHaveLength(4)
  })
  it('preserves individual empty and changed roles when the common pair changes', () => {
    expect(getDraftSpecialists({ common: { first: 5, second: 5 }, documents: { doc: { first: null } } }, 'doc')).toEqual({ first: null, second: 5 })
    expect(getDraftSpecialists({ common: { first: 6, second: 6 }, documents: { doc: { first: 1 } } }, 'doc')).toEqual({ first: 1, second: 6 })
  })
  it('has eight distinct fields with four visible per matching template and no live card lookup', () => {
    expect(new Set(SPECIALIST_TEMPLATE_FIELDS.map(field => field.key)).size).toBe(8)
    const snapshot = { first: { id: 1, name: 'Иванов', certificate: '123' } }
    for (const field of getSpecialistTemplateFields('lnkConclusionVik')) expect(getSpecialistTemplateValue(field.key, snapshot, 'lnkConclusion', 'ВИК')).toBe(field.role === 'second' ? '' : field.value === 'name' ? 'Иванов' : '123')
    for (const field of getSpecialistTemplateFields('pstoConclusion')) expect(getSpecialistTemplateValue(field.key, snapshot, 'lnkConclusion', 'ВИК')).toBe('')
    expect(getSpecialistTemplateValue('__controlPerformedName', null, 'lnkConclusion', 'ВИК')).toBe('')
  })
  it('passes per-document assignments with creation grouping without leaking them into request documents', () => {
    const build = (type: 'lnkConclusion' | 'lnkRequest') => buildSystemDocumentCreationPlan({ type, methodCode: 'ВИК', date: '2026-10-12', rows: [{ id: 1, projectTitle: 'P', line: 'L' } as WeldRow], naming: { mode: 'system', customName: '', specialists: { common: { first: 1, second: null } } }, settings: REQUEST_CONCLUSION_DEFAULT_SETTINGS })
    const command = getCreationGroupingCommand(build('lnkConclusion').groups)!
    expect(normalizeDocumentGroupingCommand(command)?.specialists?.[0].selection).toEqual({ first: 1, second: null })
    expect(getCreationGroupingCommand(build('lnkRequest').groups)?.specialists).toBeUndefined()
  })
  it('does not interpret absent fields as clearing', () => {
    expect(normalizeSpecialistSelection({ first: undefined, second: null })).toEqual({ second: null })
    for (const first of [0, -1, 1.2, NaN, '1']) expect(() => normalizeSpecialistSelection({ first } as never)).toThrow('Некорректный')
  })
})
