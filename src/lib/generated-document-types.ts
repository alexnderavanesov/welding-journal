import { CUSTOM_DOCUMENT_TYPES, DEFAULT_CUSTOM_DOCUMENT_NAMES, isCustomDocumentType, type CustomDocumentNames } from './custom-document-types'

export const MANUAL_GENERATED_DOCUMENT_TYPES = ['weldingJournal', 'checklist', 'zni', ...CUSTOM_DOCUMENT_TYPES] as const

export const LAYERED_CONTROL_DOCUMENT_TYPES = [
  'layeredVikEdges',
  'layeredVikLayers',
  'layeredPvkEdges',
  'layeredPvkLayers',
] as const

export const GENERATED_DOCUMENT_TYPES = [
  ...MANUAL_GENERATED_DOCUMENT_TYPES,
  ...LAYERED_CONTROL_DOCUMENT_TYPES,
] as const

export type ManualGeneratedDocumentType = (typeof MANUAL_GENERATED_DOCUMENT_TYPES)[number]
export type LayeredControlDocumentType = (typeof LAYERED_CONTROL_DOCUMENT_TYPES)[number]
export type GeneratedDocumentType = (typeof GENERATED_DOCUMENT_TYPES)[number]

export type GeneratedDocumentFieldKey =
  | 'jsrDocument'
  | 'checklistDocument'
  | 'zniDocument'
  | 'custom1Document'
  | 'custom2Document'
  | 'layeredVikEdgesDocument'
  | 'layeredVikLayersDocument'
  | 'layeredPvkEdgesDocument'
  | 'layeredPvkLayersDocument'

export type GeneratedDocumentIdKey =
  | 'jsrDocumentId'
  | 'checklistDocumentId'
  | 'zniDocumentId'
  | 'custom1DocumentId'
  | 'custom2DocumentId'
  | 'layeredVikEdgesDocumentId'
  | 'layeredVikLayersDocumentId'
  | 'layeredPvkEdgesDocumentId'
  | 'layeredPvkLayersDocumentId'

export const GENERATED_DOCUMENT_FIELD_KEYS = [
  'jsrDocument',
  'checklistDocument',
  'zniDocument',
  'custom1Document',
  'custom2Document',
  'layeredVikEdgesDocument',
  'layeredVikLayersDocument',
  'layeredPvkEdgesDocument',
  'layeredPvkLayersDocument',
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
  custom1: {
    label: DEFAULT_CUSTOM_DOCUMENT_NAMES.custom1,
    formationLabel: DEFAULT_CUSTOM_DOCUMENT_NAMES.custom1,
    fieldKey: 'custom1Document',
    idKey: 'custom1DocumentId',
    sheetName: 'Пользовательский 1',
  },
  custom2: {
    label: DEFAULT_CUSTOM_DOCUMENT_NAMES.custom2,
    formationLabel: DEFAULT_CUSTOM_DOCUMENT_NAMES.custom2,
    fieldKey: 'custom2Document',
    idKey: 'custom2DocumentId',
    sheetName: 'Пользовательский 2',
  },
  layeredVikEdges: {
    label: 'ВИК кромок',
    formationLabel: 'заключения ВИК кромок',
    fieldKey: 'layeredVikEdgesDocument',
    idKey: 'layeredVikEdgesDocumentId',
    sheetName: 'ВИК кромок',
  },
  layeredVikLayers: {
    label: 'ВИК слоёв',
    formationLabel: 'заключения ВИК слоёв',
    fieldKey: 'layeredVikLayersDocument',
    idKey: 'layeredVikLayersDocumentId',
    sheetName: 'ВИК слоёв',
  },
  layeredPvkEdges: {
    label: 'ПВК кромок',
    formationLabel: 'заключения ПВК кромок',
    fieldKey: 'layeredPvkEdgesDocument',
    idKey: 'layeredPvkEdgesDocumentId',
    sheetName: 'ПВК кромок',
  },
  layeredPvkLayers: {
    label: 'ПВК слоёв',
    formationLabel: 'заключения ПВК слоёв',
    fieldKey: 'layeredPvkLayersDocument',
    idKey: 'layeredPvkLayersDocumentId',
    sheetName: 'ПВК слоёв',
  },
} as const satisfies Record<
  GeneratedDocumentType,
  {
    label: string
    formationLabel: string
    fieldKey: GeneratedDocumentFieldKey
    idKey: GeneratedDocumentIdKey
    sheetName: string
  }
>

export function isGeneratedDocumentType(value: unknown): value is GeneratedDocumentType {
  return GENERATED_DOCUMENT_TYPES.includes(value as GeneratedDocumentType)
}

export function isManualGeneratedDocumentType(value: unknown): value is ManualGeneratedDocumentType {
  return MANUAL_GENERATED_DOCUMENT_TYPES.includes(value as ManualGeneratedDocumentType)
}

export function isLayeredControlDocumentType(value: unknown): value is LayeredControlDocumentType {
  return LAYERED_CONTROL_DOCUMENT_TYPES.includes(value as LayeredControlDocumentType)
}

export function getGeneratedDocumentProfile(type: GeneratedDocumentType, names?: CustomDocumentNames) {
  const profile = GENERATED_DOCUMENT_PROFILES[type]
  return names && isCustomDocumentType(type)
    ? { ...profile, label: names[type], formationLabel: names[type] }
    : profile
}
