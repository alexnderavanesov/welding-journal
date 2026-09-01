import { ALL_LNK_FIELD_METHODS as LNK_METHODS } from '@/lib/lnk-report-config'
import type {
  SystemDocumentReference,
  SystemDocumentType,
} from '@/lib/system-document-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { getPreHeatTreatmentReportField } from '@/lib/pre-heat-treatment-report-fields'

export const LNK_CONCLUSION_TEMPLATE_PROFILES = [
  {
    id: 'lnkConclusionVik',
    label: 'ВИК',
    fullLabel: 'Заключение ВИК',
    description: 'Шаблон заключения по визуальному и измерительному контролю.',
    methodCodes: ['ВИК'],
  },
  {
    id: 'lnkConclusionRk',
    label: 'РК',
    fullLabel: 'Заключение РК',
    description: 'Шаблон заключения по радиографическому контролю.',
    methodCodes: ['РК'],
  },
  {
    id: 'lnkConclusionUzk',
    label: 'УЗК',
    fullLabel: 'Заключение УЗК',
    description: 'Шаблон заключения по ультразвуковому контролю.',
    methodCodes: ['УЗК'],
  },
  {
    id: 'lnkConclusionPvk',
    label: 'ПВК',
    fullLabel: 'Заключение ПВК',
    description: 'Шаблон заключения по капиллярному контролю.',
    methodCodes: ['ПВК'],
  },
] as const

const LEGACY_LNK_CONCLUSION_TEMPLATE_PROFILE = {
  id: 'lnkConclusionOther',
  documentType: 'lnkConclusion',
  label: 'Устаревшие прочие заключения',
  description: 'Скрытый тип для совместимости с ранее созданными записями.',
} as const

export type LnkConclusionTemplateId =
  | (typeof LNK_CONCLUSION_TEMPLATE_PROFILES)[number]['id']
  | typeof LEGACY_LNK_CONCLUSION_TEMPLATE_PROFILE.id

export const CONFIGURABLE_SYSTEM_DOCUMENT_TEMPLATE_PROFILES = [
  {
    id: 'lnkRequest',
    documentType: 'lnkRequest',
    label: 'Заявка ЛНК',
    description: 'Шаблон заявки на ВИК, РК, УЗК и ПВК.',
  },
  ...LNK_CONCLUSION_TEMPLATE_PROFILES.map((profile) => ({
    id: profile.id,
    documentType: 'lnkConclusion' as const,
    label: profile.fullLabel,
    description: profile.description,
  })),
  {
    id: 'pstoRequest',
    documentType: 'pstoRequest',
    label: 'Заявка ПСТО',
    description: 'Шаблон заявки на проведение термообработки.',
  },
  {
    id: 'pstoConclusion',
    documentType: 'pstoConclusion',
    label: 'Заключение ПСТО',
    description: 'Шаблон заключения по результатам термообработки.',
  },
  {
    id: 'tvmtRequest',
    documentType: 'lnkRequest',
    label: 'Заявка ТВМТ',
    description: 'Отдельный шаблон заявки на твердометрию.',
  },
  {
    id: 'tvmtConclusion',
    documentType: 'lnkConclusion',
    label: 'Заключение ТВМТ',
    description: 'Отдельный шаблон заключения по твердометрии.',
  },
] as const

export const SYSTEM_DOCUMENT_TEMPLATE_PROFILES = [
  ...CONFIGURABLE_SYSTEM_DOCUMENT_TEMPLATE_PROFILES,
  LEGACY_LNK_CONCLUSION_TEMPLATE_PROFILE,
] as const

export type SystemDocumentTemplateId =
  (typeof SYSTEM_DOCUMENT_TEMPLATE_PROFILES)[number]['id']

const SYSTEM_DOCUMENT_TEMPLATE_IDS = new Set<string>(
  SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map((profile) => profile.id),
)
const LNK_CONCLUSION_TEMPLATE_IDS = new Set<string>(
  [
    ...LNK_CONCLUSION_TEMPLATE_PROFILES.map((profile) => profile.id),
    LEGACY_LNK_CONCLUSION_TEMPLATE_PROFILE.id,
  ],
)
const LNK_CONCLUSION_METHOD_BY_FIELD = new Map<WeldFieldKey, string>(
  LNK_METHODS.map((method) => [method.conclusionKey, method.code]),
)
const LNK_REQUEST_METHOD_BY_FIELD = new Map<WeldFieldKey, string>(
  LNK_METHODS.map((method) => [method.requestKey, method.code]),
)
const DOCUMENT_LNK_METHOD_CODES = new Set(['ВИК', 'РК', 'УЗК', 'ПВК'])

export function isSystemDocumentTemplateId(
  value: unknown,
): value is SystemDocumentTemplateId {
  return SYSTEM_DOCUMENT_TEMPLATE_IDS.has(String(value ?? ''))
}

export function isLnkConclusionTemplateId(
  value: unknown,
): value is LnkConclusionTemplateId {
  return LNK_CONCLUSION_TEMPLATE_IDS.has(String(value ?? ''))
}

export function getSystemDocumentTemplateLoadCandidates(
  templateId: SystemDocumentTemplateId,
): SystemDocumentTemplateId[] {
  if (templateId === 'tvmtRequest') return ['tvmtRequest', 'lnkRequest']
  if (templateId === 'tvmtConclusion') return ['tvmtConclusion', 'lnkConclusionOther']
  return [templateId]
}

export function resolveAvailableSystemDocumentTemplateIds(
  values: readonly unknown[],
): Set<SystemDocumentTemplateId> {
  const available = new Set(values.filter(isSystemDocumentTemplateId))
  if (!available.has('tvmtRequest') && available.has('lnkRequest')) {
    available.add('tvmtRequest')
  }
  if (!available.has('tvmtConclusion') && available.has('lnkConclusionOther')) {
    available.add('tvmtConclusion')
  }
  return available
}

export function getSystemDocumentTypeForTemplateId(
  templateId: SystemDocumentTemplateId,
): SystemDocumentType {
  return SYSTEM_DOCUMENT_TEMPLATE_PROFILES.find((profile) => profile.id === templateId)!
    .documentType
}

export function getLnkConclusionTemplateProfile(
  methodCode: string | undefined,
) {
  const normalizedMethod = String(methodCode ?? '').trim().toLocaleUpperCase('ru-RU')
  return (
    LNK_CONCLUSION_TEMPLATE_PROFILES.find((profile) =>
      profile.methodCodes.some((code) => code === normalizedMethod),
    ) ?? LEGACY_LNK_CONCLUSION_TEMPLATE_PROFILE
  )
}

export function getLnkConclusionTemplateMethodCodes(
  templateId: LnkConclusionTemplateId,
) {
  return LNK_METHODS
    .filter((method) => getSystemDocumentTemplateId({
      type: 'lnkConclusion',
      methodCode: method.code,
    }) === templateId)
    .map((method) => method.code)
}

export function getSystemDocumentTemplateId(
  reference: Pick<SystemDocumentReference, 'type' | 'methodCode'>,
): SystemDocumentTemplateId {
  const methodCode = String(reference.methodCode ?? '').trim().toLocaleUpperCase('ru-RU')
  if (reference.type === 'lnkRequest' && methodCode === 'ТВМТ') {
    return 'tvmtRequest'
  }
  if (reference.type === 'lnkConclusion') {
    if (methodCode === 'ТВМТ') return 'tvmtConclusion'
    return getLnkConclusionTemplateProfile(reference.methodCode).id
  }
  return reference.type
}

export function getSystemDocumentTemplateIdForField(
  fieldKey: WeldFieldKey,
): SystemDocumentTemplateId | null {
  const preField = getPreHeatTreatmentReportField(fieldKey)
  if (preField?.valueKey === 'requestName') return 'lnkRequest'
  if (preField?.valueKey === 'conclusionName') {
    return getLnkConclusionTemplateProfile(preField.methodCode).id
  }
  const methodCode = LNK_CONCLUSION_METHOD_BY_FIELD.get(fieldKey)
  if (methodCode) {
    if (methodCode === 'ТВМТ') return 'tvmtConclusion'
    return DOCUMENT_LNK_METHOD_CODES.has(methodCode)
      ? getLnkConclusionTemplateProfile(methodCode).id
      : null
  }
  const requestMethodCode = LNK_REQUEST_METHOD_BY_FIELD.get(fieldKey)
  if (requestMethodCode === 'ТВМТ') return 'tvmtRequest'
  if (requestMethodCode && DOCUMENT_LNK_METHOD_CODES.has(requestMethodCode)) return 'lnkRequest'
  if (fieldKey === 'pstoRequest') return 'pstoRequest'
  if (fieldKey === 'heatTreatmentDiagram') return 'pstoConclusion'
  return null
}
