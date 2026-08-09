import { LNK_METHODS } from '@/lib/lnk-report-config'
import type {
  SystemDocumentReference,
  SystemDocumentType,
} from '@/lib/system-document-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

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
  {
    id: 'lnkConclusionOther',
    label: 'Прочие',
    fullLabel: 'Заключение прочие',
    description: 'Общий шаблон для ТВМТ, РФА, СТЛС, МКК и других видов НК без отдельной формы.',
    methodCodes: [],
    fallback: true,
  },
] as const

export type LnkConclusionTemplateId =
  (typeof LNK_CONCLUSION_TEMPLATE_PROFILES)[number]['id']

export const SYSTEM_DOCUMENT_TEMPLATE_PROFILES = [
  {
    id: 'lnkRequest',
    documentType: 'lnkRequest',
    label: 'Заявка ЛНК',
    description: 'Шаблон заявки на контроль.',
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
] as const

export type SystemDocumentTemplateId =
  (typeof SYSTEM_DOCUMENT_TEMPLATE_PROFILES)[number]['id']

const SYSTEM_DOCUMENT_TEMPLATE_IDS = new Set<string>(
  SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map((profile) => profile.id),
)
const LNK_CONCLUSION_TEMPLATE_IDS = new Set<string>(
  LNK_CONCLUSION_TEMPLATE_PROFILES.map((profile) => profile.id),
)
const LNK_CONCLUSION_METHOD_BY_FIELD = new Map<WeldFieldKey, string>(
  LNK_METHODS.map((method) => [method.conclusionKey, method.code]),
)

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
    ) ??
    LNK_CONCLUSION_TEMPLATE_PROFILES.find((profile) => 'fallback' in profile) ??
    LNK_CONCLUSION_TEMPLATE_PROFILES[LNK_CONCLUSION_TEMPLATE_PROFILES.length - 1]
  )
}

export function getSystemDocumentTemplateId(
  reference: Pick<SystemDocumentReference, 'type' | 'methodCode'>,
): SystemDocumentTemplateId {
  if (reference.type === 'lnkConclusion') {
    return getLnkConclusionTemplateProfile(reference.methodCode).id
  }
  return reference.type
}

export function getSystemDocumentTemplateIdForField(
  fieldKey: WeldFieldKey,
): SystemDocumentTemplateId | null {
  const methodCode = LNK_CONCLUSION_METHOD_BY_FIELD.get(fieldKey)
  if (methodCode) {
    return getLnkConclusionTemplateProfile(methodCode).id
  }
  if (LNK_METHODS.some((method) => method.requestKey === fieldKey)) return 'lnkRequest'
  if (fieldKey === 'pstoRequest') return 'pstoRequest'
  if (fieldKey === 'heatTreatmentDiagram') return 'pstoConclusion'
  return null
}
