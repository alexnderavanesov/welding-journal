import { describe, expect, it } from 'vitest'

import {
  CONFIGURABLE_SYSTEM_DOCUMENT_TEMPLATE_PROFILES,
  LNK_CONCLUSION_TEMPLATE_PROFILES,
  getLnkConclusionTemplateMethodCodes,
  getLnkConclusionTemplateProfile,
  getSystemDocumentTemplateId,
  getSystemDocumentTemplateIdForField,
  getSystemDocumentTemplateLoadCandidates,
  getSystemDocumentTypeForTemplateId,
  isSystemDocumentTemplateId,
  resolveAvailableSystemDocumentTemplateIds,
} from '@/lib/system-document-template-types'

describe('system document template routing', () => {
  it.each([
    ['ВИК', 'lnkConclusionVik'],
    ['РК', 'lnkConclusionRk'],
    ['УЗК', 'lnkConclusionUzk'],
    ['ПВК', 'lnkConclusionPvk'],
    ['ТВМТ', 'tvmtConclusion'],
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

  it('keeps the hidden legacy fallback outside active LNK methods', () => {
    expect(getLnkConclusionTemplateMethodCodes('lnkConclusionOther')).toEqual([])
  })

  it('keeps only supported document methods in the visible settings', () => {
    expect(LNK_CONCLUSION_TEMPLATE_PROFILES.map((profile) => profile.label)).toEqual([
      'ВИК',
      'РК',
      'УЗК',
      'ПВК',
    ])
    expect(CONFIGURABLE_SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map((profile) => profile.id)).toEqual([
      'lnkRequest',
      'lnkConclusionVik',
      'lnkConclusionRk',
      'lnkConclusionUzk',
      'lnkConclusionPvk',
      'pstoRequest',
      'pstoConclusion',
      'tvmtRequest',
      'tvmtConclusion',
    ])
  })

  it('maps report fields to the exact template that makes the cell clickable', () => {
    expect(getSystemDocumentTemplateIdForField('vikConclusion')).toBe(
      'lnkConclusionVik',
    )
    expect(getSystemDocumentTemplateIdForField('tvmtRequest')).toBe('tvmtRequest')
    expect(getSystemDocumentTemplateIdForField('tvmtConclusion')).toBe('tvmtConclusion')
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
    expect(getSystemDocumentTypeForTemplateId('tvmtRequest')).toBe('lnkRequest')
    expect(getSystemDocumentTypeForTemplateId('tvmtConclusion')).toBe('lnkConclusion')
  })

  it('accepts only actual stored system template identifiers', () => {
    expect(isSystemDocumentTemplateId('lnkConclusionRk')).toBe(true)
    expect(isSystemDocumentTemplateId('tvmtConclusion')).toBe(true)
    expect(isSystemDocumentTemplateId('lnkConclusion')).toBe(false)
  })

  it('routes the TVMT request to an independent template', () => {
    expect(getSystemDocumentTemplateId({
      type: 'lnkRequest',
      methodCode: 'ТВМТ',
    })).toBe('tvmtRequest')
  })

  it('keeps old shared templates as read-only fallbacks for TVMT', () => {
    expect(getSystemDocumentTemplateLoadCandidates('tvmtRequest')).toEqual([
      'tvmtRequest',
      'lnkRequest',
    ])
    expect(getSystemDocumentTemplateLoadCandidates('tvmtConclusion')).toEqual([
      'tvmtConclusion',
      'lnkConclusionOther',
    ])
    expect(resolveAvailableSystemDocumentTemplateIds([
      'lnkRequest',
      'lnkConclusionOther',
    ])).toEqual(new Set([
      'lnkRequest',
      'lnkConclusionOther',
      'tvmtRequest',
      'tvmtConclusion',
    ]))
  })
})
