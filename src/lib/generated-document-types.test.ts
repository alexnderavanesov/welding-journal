import { describe, expect, it } from 'vitest'

import { DOCUMENT_TEMPLATE_TYPES } from '@/lib/document-template-storage'
import { buildDocumentTemplateName, createDefaultDocumentTemplateNameConfig } from '@/lib/document-template-name'
import {
  GENERATED_DOCUMENT_TYPES,
  LAYERED_CONTROL_DOCUMENT_TYPES,
  MANUAL_GENERATED_DOCUMENT_TYPES,
  isGeneratedDocumentFieldKey,
  isManualGeneratedDocumentType,
} from '@/lib/generated-document-types'

describe('generated document types', () => {
  it('keeps automatic layered conclusions outside manual generation', () => {
    expect(MANUAL_GENERATED_DOCUMENT_TYPES).toEqual(['weldingJournal', 'checklist', 'zni'])
    expect(GENERATED_DOCUMENT_TYPES).toEqual([
      ...MANUAL_GENERATED_DOCUMENT_TYPES,
      ...LAYERED_CONTROL_DOCUMENT_TYPES,
    ])
    expect(isManualGeneratedDocumentType('layeredVikEdges')).toBe(false)
  })

  it('places the four layered templates after the TVMT conclusion', () => {
    expect(DOCUMENT_TEMPLATE_TYPES.slice(-5).map((template) => template.id)).toEqual([
      'tvmtConclusion',
      ...LAYERED_CONTROL_DOCUMENT_TYPES,
    ])
  })

  it('recognizes each singular layered document field as an openable generated document', () => {
    expect(isGeneratedDocumentFieldKey('layeredVikEdgesDocument')).toBe(true)
    expect(isGeneratedDocumentFieldKey('layeredPvkLayersDocument')).toBe(true)
    expect(isGeneratedDocumentFieldKey('layeredVikDocuments')).toBe(false)
  })

  it('gives layered constructors a per-joint default name with a four-digit date', () => {
    expect(createDefaultDocumentTemplateNameConfig('layeredVikLayers').parts).toEqual([
      { type: 'text', text: 'ВИК - слои - ' },
      { type: 'field', field: 'joint' },
      { type: 'text', text: ' - ' },
      { type: 'field', field: 'weldDate' },
    ])
    expect(buildDocumentTemplateName({
      templateId: 'layeredVikLayers',
      config: createDefaultDocumentTemplateNameConfig('layeredVikLayers'),
      records: [{ joint: 'S4', weldDate: '2026-09-01' }],
      periodFrom: '2026-09-01',
      periodTo: '2026-09-01',
    })).toBe('ВИК - слои - S4 - 01.09.2026')
  })
})
