import { expect, it } from 'vitest'
import { changedSystemDocumentNameError } from './system-document-name-conflict'
import { systemDocumentNameKey } from './system-document-name-allocation'

const pattern = 'Заявка-{{Шифр}}-{{№}}'
const context = { subtitleCode: 'CODE', date: new Date('2026-10-31T00:00:00') }
const base = { pattern, namingPattern: pattern, context, date: '2026-10-31', provisionalName: 'Заявка-CODE-001', number: 2, occupiedNames: new Set<string>() }

it('distinguishes an occupied full name from a changed counter, rule and row context', () => {
  expect(changedSystemDocumentNameError({ ...base, occupiedNames: new Set([systemDocumentNameKey(base.date, base.provisionalName)]) }).code).toBe('DOCUMENT_NAME_OCCUPIED')
  expect(changedSystemDocumentNameError(base).code).toBe('DOCUMENT_NUMBER_CHANGED')
  expect(changedSystemDocumentNameError({ ...base, pattern: 'Новое-{{№}}' }).code).toBe('DOCUMENT_SETTINGS_CHANGED')
  expect(changedSystemDocumentNameError({ ...base, context: { ...context, subtitleCode: 'MOVED' } }).code).toBe('DOCUMENT_CONTEXT_CHANGED')
})

it('keeps another date free and does not guess the cause for an older client or malformed display', () => {
  expect(changedSystemDocumentNameError({ ...base, occupiedNames: new Set([systemDocumentNameKey('2026-10-30', base.provisionalName)]) }).code).toBe('DOCUMENT_NUMBER_CHANGED')
  expect(changedSystemDocumentNameError({ ...base, namingPattern: undefined, context: { ...context, subtitleCode: 'MOVED' } }).code).toBe('DOCUMENT_PREVIEW_CHANGED')
  expect(changedSystemDocumentNameError({ ...base, number: 1, provisionalName: 'Заявка-CODE-1' }).code).toBe('DOCUMENT_PREVIEW_CHANGED')
})

it('never includes actual private context or replacement values in a public error', () => {
  const error = changedSystemDocumentNameError({ ...base, context: { ...context, subtitleCode: 'PRIVATE' }, provisionalName: 'OLD-PRIVATE', pattern: 'SECRET-{{№}}' })
  expect(error.message).not.toMatch(/PRIVATE|SECRET|2026-10-31/)
  expect(error.message).toContain('Ничего не сохранено')
  expect(error.message).toContain('Обновить номера и имена')
})
