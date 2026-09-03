import { FIELD_BY_KEY, type WeldInput } from '@/lib/weld-fields'
import {
  DOCUMENT_FORMATION_DATE_TOKEN,
  DOCUMENT_SEQUENCE_NUMBER_TOKEN,
} from '@/lib/generated-document-naming'
import {
  getGeneratedDocumentProfile,
  isGeneratedDocumentType,
  isLayeredControlDocumentType,
  type GeneratedDocumentType,
} from '@/lib/generated-document-types'
import { getLayeredControlDocumentProfile } from '@/lib/layered-control-documents'

export type DocumentTemplateNameFieldKey =
  | keyof WeldInput
  | '__periodFrom'
  | '__periodTo'
  | '__formationDate'
  | '__documentNumber'

export type DocumentTemplateNamePart = {
  type: 'text' | 'field'
  text?: string
  field?: DocumentTemplateNameFieldKey
}

export type DocumentTemplateNameConfig = {
  parts: DocumentTemplateNamePart[]
}

export function createDefaultDocumentTemplateNameConfig(
  templateId: GeneratedDocumentType | string = 'weldingJournal',
): DocumentTemplateNameConfig {
  if (isLayeredControlDocumentType(templateId)) {
    const profile = getLayeredControlDocumentProfile(templateId)
    return {
      parts: [
        { type: 'text', text: `${profile.method} - ${profile.fallbackStageLabel} - ` },
        { type: 'field', field: 'joint' },
        { type: 'text', text: ' - ' },
        { type: 'field', field: 'weldDate' },
      ],
    }
  }

  const documentLabel =
    templateId === 'weldingJournal'
      ? 'Сварочный журнал'
      : isGeneratedDocumentType(templateId)
        ? getGeneratedDocumentProfile(templateId).label
        : 'Документ'
  return {
    parts: [
      { type: 'field', field: 'subtitleCode' },
      { type: 'text', text: ` - ${documentLabel} - ` },
      { type: 'field', field: '__periodFrom' },
      { type: 'text', text: ' - ' },
      { type: 'field', field: '__periodTo' },
    ],
  }
}

export function buildDocumentTemplateName({
  config,
  records,
  periodFrom,
  periodTo,
  templateId = 'weldingJournal',
}: {
  config?: DocumentTemplateNameConfig
  records: WeldInput[]
  periodFrom: string
  periodTo: string
  templateId?: GeneratedDocumentType | string
}) {
  const currentConfig = config ?? createDefaultDocumentTemplateNameConfig(templateId)
  const fullYearDates = isLayeredControlDocumentType(templateId)
  const value = currentConfig.parts
    .map((part) => {
      if (part.type === 'text') return part.text ?? ''
      if (!part.field) return ''
      if (part.field === '__periodFrom') return formatDocumentNameDate(periodFrom, fullYearDates)
      if (part.field === '__periodTo') return formatDocumentNameDate(periodTo, fullYearDates)
      if (part.field === '__formationDate') return DOCUMENT_FORMATION_DATE_TOKEN
      if (part.field === '__documentNumber') return DOCUMENT_SEQUENCE_NUMBER_TOKEN

      const field = FIELD_BY_KEY.get(part.field)
      const values = Array.from(
        new Set(
          records
            .map((record) => {
              const rawValue = record[part.field as keyof WeldInput]
              if (rawValue == null || rawValue === '') return ''
              return field?.kind === 'date'
                ? formatDocumentNameDate(String(rawValue), fullYearDates)
                : String(rawValue).trim()
            })
            .filter(Boolean),
        ),
      ).sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }))

      if (values.length <= 3) return values.join(', ')
      return `${values.slice(0, 3).join(', ')} и еще ${values.length - 3}`
    })
    .join('')

  return sanitizeDocumentName(value) || 'Сварочный журнал'
}

function formatDocumentNameDate(value: string, fullYear: boolean) {
  const rawValue = value.trim()
  const isoMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return `${isoMatch[3]}.${isoMatch[2]}.${fullYear ? isoMatch[1] : isoMatch[1].slice(-2)}`

  const displayMatch = rawValue.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (displayMatch) {
    return `${displayMatch[1]}.${displayMatch[2]}.${fullYear ? displayMatch[3] : displayMatch[3].slice(-2)}`
  }

  return rawValue
}

function sanitizeDocumentName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
}
