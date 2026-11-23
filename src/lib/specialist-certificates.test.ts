import { describe, expect, it } from 'vitest'
import { SPECIALIST_METHODS, getSpecialistDocumentProfile, inheritDocumentSpecialists, resolveDocumentSpecialists, type SpecialistCertificate, type SpecialistRecord } from './document-specialists'
import { getSpecialistCertificates, selectSpecialistCertificate, validateSpecialistCertificates } from './specialist-certificates'

const profile = getSpecialistDocumentProfile('lnkConclusionVik')!
const certificate = (number: string, validFrom: string | null = null, validTo: string | null = null, methods: SpecialistCertificate['methods'] = ['ВИК']): SpecialistCertificate => ({ number, validFrom, validTo, methods })
const dated = certificate('2025', '2025-01-01', '2025-12-31')
const legacy: SpecialistRecord = { id: 1, revision: 1, name: 'Иванов', certificate: 'Без дат', methods: ['ВИК'], kind: 'inspector' }
const record = { ...legacy, certificates: [certificate('Без дат'), dated] }
const validate = (items: SpecialistCertificate[], kind: SpecialistRecord['kind'] = 'inspector') => validateSpecialistCertificates(items, kind, SPECIALIST_METHODS)

describe('certificates follow conclusion date and control method', () => {
  it.each(['2025-01-01', '2025-06-15', '2025-12-31'])('prefers dated certificate on %s, including both bounds', date => {
    expect(selectSpecialistCertificate(record, profile, date)?.number).toBe('2025')
  })
  it.each(['2024-12-31', '2026-01-01'])('uses the undated fallback on %s', date => {
    expect(selectSpecialistCertificate(record, profile, date)?.number).toBe('Без дат')
  })
  it('excludes a gap and wrong method; does not use another method’s fallback', () => {
    const person = { ...legacy, methods: ['ВИК', 'РК'] as const, certificates: [certificate('Первое', '2025-01-01', '2025-05-01'), certificate('Второе', '2025-12-01', '2025-12-31'), certificate('РК', null, null, ['РК'])] }
    expect(selectSpecialistCertificate({ ...person, methods: [...person.methods] }, profile, '2025-06-01')).toBeUndefined()
    expect(selectSpecialistCertificate(record, getSpecialistDocumentProfile('lnkConclusionRk')!, '2025-06-01')).toBeUndefined()
    expect(selectSpecialistCertificate({ ...record, archived: true }, profile, '2025-01-01')).toBeUndefined()
  })
  it('accepts unchanged legacy cards and snapshots while marking explicit new assignments', () => {
    expect(getSpecialistCertificates(legacy)).toEqual([certificate('Без дат')])
    const snapshot = { first: { id: 1, name: 'Историческое ФИО', certificate: 'Исторический номер' } }
    expect(resolveDocumentSpecialists(snapshot, {}, new Map(), profile, '2025-06-01')).toEqual(snapshot)
    expect(resolveDocumentSpecialists(snapshot, { first: 1 }, new Map([[1, record]]), profile, '2025-06-01').first).toMatchObject({ certificate: '2025', certificateDate: '2025-06-01' })
    expect(() => resolveDocumentSpecialists(null, { first: 1 }, new Map([[1, { ...legacy, certificates: [dated] }]]), profile, '2026-01-01')).toThrow('нет действующего удостоверения')
  })
  it('retains date validation when identical saved details merge in either order', () => {
    const first = { id: 1, name: 'Иванов', certificate: '2025' }
    for (const snapshots of [[{ first }, { first: { ...first, certificateDate: '2025-01-01' } }], [{ first: { ...first, certificateDate: '2025-01-01' } }, { first }]]) {
      expect(inheritDocumentSpecialists(snapshots)).toMatchObject({ conflict: false, snapshot: { first: { certificateDate: '2025-01-01' } } })
    }
  })
  it('applies the same rule to thermists', () => {
    const person = { ...record, kind: 'thermist' as const, methods: [], certificates: [certificate('ПСТО', '2025-01-01', '2025-12-31', [])] }
    expect(selectSpecialistCertificate(person, getSpecialistDocumentProfile('pstoConclusion')!, '2025-12-31')?.number).toBe('ПСТО')
    expect(selectSpecialistCertificate(person, getSpecialistDocumentProfile('pstoConclusion')!, '2026-01-01')).toBeUndefined()
  })
  it('requires a conclusion date for a fresh assignment, but permits clearing an undated legacy document', () => {
    expect(() => resolveDocumentSpecialists(null, { first: 1 }, new Map([[1, legacy]]), profile, '')).toThrow('дату заключения')
    expect(resolveDocumentSpecialists({ first: { id: 1, name: 'Иванов', certificate: 'История' } }, { first: null }, new Map(), profile, '')).toEqual({ first: null })
  })
})

describe('card validation', () => {
  it('allows adjacent periods, different-method overlaps and method-specific fallbacks', () => {
    expect(validate([certificate('1', '2023-01-01', '2025-05-01'), certificate('2', '2025-05-02', '2025-12-31'), certificate('3', '2025-01-01', '2025-12-31', ['РК']), certificate('4'), certificate('5', null, null, ['РК'])])).toHaveLength(5)
  })
  it('rejects an overlapping boundary and duplicate undated method', () => {
    expect(() => validate([dated, certificate('2', '2025-12-31', '2026-01-01')])).toThrow('пересекаются')
    expect(() => validate([certificate('1'), certificate('2', null, null, ['ВИК', 'РК'])])).toThrow('только одно')
    expect(() => validate([dated, dated], 'thermist')).toThrow('пересекаются')
  })
  it.each([certificate('1', '2025-01-01'), certificate('1', null, '2025-01-01'), certificate('1', '2025-02-29', '2025-03-01'), certificate('1', '2026-01-01', '2025-01-01'), certificate(''), certificate('1', null, null, [])])('rejects incomplete or invalid certificate %#', item => {
    expect(() => validate([item])).toThrow()
  })
})
