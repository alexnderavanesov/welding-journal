export const GENERATED_DOCUMENT_TYPES = ['weldingJournal', 'checklist', 'zni'] as const

export type GeneratedDocumentType = (typeof GENERATED_DOCUMENT_TYPES)[number]

export type GeneratedDocumentFieldKey = 'jsrDocument' | 'checklistDocument' | 'zniDocument'

export const GENERATED_DOCUMENT_FIELD_KEYS = [
  'jsrDocument',
  'checklistDocument',
  'zniDocument',
] as const satisfies readonly GeneratedDocumentFieldKey[]

export function isGeneratedDocumentFieldKey(value: unknown): value is GeneratedDocumentFieldKey {
  return GENERATED_DOCUMENT_FIELD_KEYS.includes(value as GeneratedDocumentFieldKey)
}

export const GENERATED_DOCUMENT_PROFILES = {
  weldingJournal: {
    label: 'ЖСР',
    formationLabel: 'ЖСР',
    fieldKey: 'jsrDocument',
    idKey: 'jsrDocumentId',
    sheetName: 'ЖСР',
  },
  checklist: {
    label: 'Чек-лист',
    formationLabel: 'Чек-листа',
    fieldKey: 'checklistDocument',
    idKey: 'checklistDocumentId',
    sheetName: 'Чек-лист',
  },
  zni: {
    label: 'ЗНИ',
    formationLabel: 'ЗНИ',
    fieldKey: 'zniDocument',
    idKey: 'zniDocumentId',
    sheetName: 'ЗНИ',
  },
} as const satisfies Record<
  GeneratedDocumentType,
  {
    label: string
    formationLabel: string
    fieldKey: GeneratedDocumentFieldKey
    idKey: 'jsrDocumentId' | 'checklistDocumentId' | 'zniDocumentId'
    sheetName: string
  }
>

export function isGeneratedDocumentType(value: unknown): value is GeneratedDocumentType {
  return GENERATED_DOCUMENT_TYPES.includes(value as GeneratedDocumentType)
}

export function getGeneratedDocumentProfile(type: GeneratedDocumentType) {
  return GENERATED_DOCUMENT_PROFILES[type]
}
