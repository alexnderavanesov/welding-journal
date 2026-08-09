import { describe, expect, it } from 'vitest'

import {
  getLnkConclusionTemplateProfile,
  getSystemDocumentTemplateId,
  getSystemDocumentTemplateIdForField,
  getSystemDocumentTypeForTemplateId,
  isSystemDocumentTemplateId,
} from '@/lib/system-document-template-types'

describe('system document template routing', () => {
  it.each([
    ['ВИК', 'lnkConclusionVik'],
    ['РК', 'lnkConclusionRk'],
    ['УЗК', 'lnkConclusionUzk'],
    ['ПВК', 'lnkConclusionPvk'],
    ['ТВМТ', 'lnkConclusionOther'],
    ['РФА', 'lnkConclusionOther'],
    ['СТЛС', 'lnkConclusionOther'],
    ['МКК', 'lnkConclusionOther'],
  ] as const)('routes %s conclusions to %s', (methodCode, templateId) => {
    expect(
      getSystemDocumentTemplateId({
        type: 'lnkConclusion',
        methodCode,
      }),
    ).toBe(templateId)
  })

  it('uses the fallback form for a future LNK method without a dedicated template', () => {
    expect(getLnkConclusionTemplateProfile('НОВЫЙ НК').id).toBe(
      'lnkConclusionOther',
    )
  })

  it('maps report fields to the exact template that makes the cell clickable', () => {
    expect(getSystemDocumentTemplateIdForField('vikConclusion')).toBe(
      'lnkConclusionVik',
    )
    expect(getSystemDocumentTemplateIdForField('rfaConclusion')).toBe(
      'lnkConclusionOther',
    )
    expect(getSystemDocumentTemplateIdForField('vikRequest')).toBe('lnkRequest')
    expect(getSystemDocumentTemplateIdForField('pstoRequest')).toBe('pstoRequest')
  })

  it('keeps all conclusion forms under one logical LNK conclusion document type', () => {
    expect(getSystemDocumentTypeForTemplateId('lnkConclusionVik')).toBe(
      'lnkConclusion',
    )
    expect(getSystemDocumentTypeForTemplateId('lnkConclusionOther')).toBe(
      'lnkConclusion',
    )
  })

  it('accepts only actual stored system template identifiers', () => {
    expect(isSystemDocumentTemplateId('lnkConclusionRk')).toBe(true)
    expect(isSystemDocumentTemplateId('lnkConclusion')).toBe(false)
  })
})
