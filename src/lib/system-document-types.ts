import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export const SYSTEM_DOCUMENT_TYPES = [
  'lnkRequest',
  'lnkConclusion',
  'pstoRequest',
  'pstoConclusion',
] as const

export type SystemDocumentType = (typeof SYSTEM_DOCUMENT_TYPES)[number]

export type SystemDocumentReference = {
  type: SystemDocumentType
  title: string
  date: string
  methodCode?: string
}

export type SystemDocumentSummary = SystemDocumentReference & {
  id: string
  label: string
  fileName: string
  methodCodes: string[]
  rowCount: number
  positionCount: number
  projects: string[]
  subtitleCodes: string[]
  lines: string[]
  periodFrom: string
  periodTo: string
  updatedAt: string
}

export type SystemDocumentTemplateContext = {
  type: SystemDocumentType
  label: string
  title: string
  date: string
  methodCodes: string[]
  methodCode?: string
}

export const SYSTEM_DOCUMENT_PROFILES = {
  lnkRequest: {
    label: 'Заявка ЛНК',
  },
  lnkConclusion: {
    label: 'Заключение ЛНК',
  },
  pstoRequest: {
    label: 'Заявка ПСТО',
  },
  pstoConclusion: {
    label: 'Заключение ПСТО',
  },
} as const satisfies Record<SystemDocumentType, { label: string }>

const LNK_REQUEST_METHOD_BY_FIELD = new Map<WeldFieldKey, (typeof LNK_METHODS)[number]>(
  LNK_METHODS.map((method) => [method.requestKey, method]),
)
const LNK_CONCLUSION_METHOD_BY_FIELD = new Map<WeldFieldKey, (typeof LNK_METHODS)[number]>(
  LNK_METHODS.map((method) => [method.conclusionKey, method]),
)

export function isSystemDocumentType(value: unknown): value is SystemDocumentType {
  return SYSTEM_DOCUMENT_TYPES.includes(value as SystemDocumentType)
}

export function getSystemDocumentProfile(type: SystemDocumentType) {
  return SYSTEM_DOCUMENT_PROFILES[type]
}

export function getSystemDocumentTypeForField(fieldKey: WeldFieldKey): SystemDocumentType | null {
  if (LNK_REQUEST_METHOD_BY_FIELD.has(fieldKey)) return 'lnkRequest'
  if (LNK_CONCLUSION_METHOD_BY_FIELD.has(fieldKey)) return 'lnkConclusion'
  if (fieldKey === 'pstoRequest') return 'pstoRequest'
  if (fieldKey === 'heatTreatmentDiagram') return 'pstoConclusion'
  return null
}

export function getSystemDocumentReferenceForField(
  row: WeldRow,
  fieldKey: WeldFieldKey,
): SystemDocumentReference | null {
  const requestMethod = LNK_REQUEST_METHOD_BY_FIELD.get(fieldKey)
  if (requestMethod) {
    return createReference({
      type: 'lnkRequest',
      title: row[requestMethod.requestKey],
      date: row[requestMethod.requestDateKey],
    })
  }

  const conclusionMethod = LNK_CONCLUSION_METHOD_BY_FIELD.get(fieldKey)
  if (conclusionMethod) {
    return createReference({
      type: 'lnkConclusion',
      title: row[conclusionMethod.conclusionKey],
      date: row[conclusionMethod.conclusionDateKey],
      methodCode: conclusionMethod.code,
    })
  }

  if (fieldKey === 'pstoRequest') {
    return createReference({
      type: 'pstoRequest',
      title: row.pstoRequest,
      date: row.pstoRequestDate,
    })
  }

  if (fieldKey === 'heatTreatmentDiagram') {
    return createReference({
      type: 'pstoConclusion',
      title: row.heatTreatmentDiagram,
      date: row.pstoDate,
    })
  }

  return null
}

export function buildSystemDocumentSummaries(
  rows: Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>,
  type: SystemDocumentType,
): SystemDocumentSummary[] {
  const groups = new Map<string, MutableSystemDocumentSummary>()

  for (const row of rows) {
    if (type === 'lnkRequest') {
      for (const method of LNK_METHODS) {
        const reference = createReference({
          type,
          title: row[method.requestKey],
          date: row[method.requestDateKey],
        })
        if (reference) addSummaryPosition(groups, reference, row, method.code)
      }
      continue
    }

    if (type === 'lnkConclusion') {
      for (const method of LNK_METHODS) {
        const reference = createReference({
          type,
          title: row[method.conclusionKey],
          date: row[method.conclusionDateKey],
          methodCode: method.code,
        })
        if (reference) addSummaryPosition(groups, reference, row, method.code)
      }
      continue
    }

    const reference =
      type === 'pstoRequest'
        ? createReference({ type, title: row.pstoRequest, date: row.pstoRequestDate })
        : createReference({ type, title: row.heatTreatmentDiagram, date: row.pstoDate })
    if (reference) addSummaryPosition(groups, reference, row)
  }

  return Array.from(groups.values())
    .map(finalizeSystemDocumentSummary)
    .sort((left, right) => {
      const dateDelta = right.date.localeCompare(left.date, 'ru', { numeric: true })
      if (dateDelta !== 0) return dateDelta
      return right.title.localeCompare(left.title, 'ru', { numeric: true })
    })
}

export function createSystemDocumentTemplateContext(
  reference: SystemDocumentReference,
  methodCodes: string[] = reference.methodCode ? [reference.methodCode] : [],
): SystemDocumentTemplateContext {
  return {
    ...reference,
    label: getSystemDocumentProfile(reference.type).label,
    methodCodes,
  }
}

export function getSystemDocumentRowResult(
  row: WeldInput,
  context: SystemDocumentTemplateContext,
) {
  if (context.type === 'pstoConclusion') return row.pstoResult ?? ''
  if (context.type !== 'lnkConclusion' || !context.methodCode) return ''
  const method = LNK_METHODS.find((candidate) => candidate.code === context.methodCode)
  return method ? row[method.resultKey] ?? '' : ''
}

export function getSystemDocumentId(reference: SystemDocumentReference) {
  return JSON.stringify([
    reference.type,
    reference.title,
    reference.date,
    reference.methodCode ?? '',
  ])
}

function createReference({
  type,
  title,
  date,
  methodCode,
}: {
  type: SystemDocumentType
  title: unknown
  date: unknown
  methodCode?: string
}): SystemDocumentReference | null {
  const normalizedTitle = normalizeText(title)
  if (!normalizedTitle) return null
  return {
    type,
    title: normalizedTitle,
    date: normalizeDateValue(date),
    ...(methodCode ? { methodCode } : {}),
  }
}

type MutableSystemDocumentSummary = SystemDocumentReference & {
  rowIds: Set<number>
  positionKeys: Set<string>
  methodCodes: Set<string>
  projects: Set<string>
  subtitleCodes: Set<string>
  lines: Set<string>
  weldDates: Set<string>
  updatedAt: string
}

function addSummaryPosition(
  groups: Map<string, MutableSystemDocumentSummary>,
  reference: SystemDocumentReference,
  row: Partial<WeldRow> & Pick<WeldRow, 'id'>,
  methodCode?: string,
) {
  const id = getSystemDocumentId(reference)
  const group = groups.get(id) ?? {
    ...reference,
    rowIds: new Set<number>(),
    positionKeys: new Set<string>(),
    methodCodes: new Set<string>(),
    projects: new Set<string>(),
    subtitleCodes: new Set<string>(),
    lines: new Set<string>(),
    weldDates: new Set<string>(),
    updatedAt: '',
  }
  group.rowIds.add(row.id)
  group.positionKeys.add(`${row.id}:${methodCode ?? ''}`)
  if (methodCode) group.methodCodes.add(methodCode)
  addText(group.projects, row.projectTitle)
  addText(group.subtitleCodes, row.subtitleCode)
  addText(group.lines, row.line)
  addText(group.weldDates, normalizeDateValue(row.weldDate))
  const updatedAt = normalizeTimestamp((row as Partial<WeldRow> & { updatedAt?: unknown }).updatedAt)
  if (updatedAt > group.updatedAt) group.updatedAt = updatedAt
  groups.set(id, group)
}

function finalizeSystemDocumentSummary(group: MutableSystemDocumentSummary): SystemDocumentSummary {
  const weldDates = sortValues(group.weldDates)
  return {
    type: group.type,
    title: group.title,
    date: group.date,
    ...(group.methodCode ? { methodCode: group.methodCode } : {}),
    id: getSystemDocumentId(group),
    label: getSystemDocumentProfile(group.type).label,
    fileName: `${sanitizeFileName(group.title)}.xlsx`,
    methodCodes: sortValues(group.methodCodes),
    rowCount: group.rowIds.size,
    positionCount: group.positionKeys.size,
    projects: sortValues(group.projects),
    subtitleCodes: sortValues(group.subtitleCodes),
    lines: sortValues(group.lines),
    periodFrom: weldDates[0] ?? '',
    periodTo: weldDates[weldDates.length - 1] ?? '',
    updatedAt: group.updatedAt,
  }
}

function addText(values: Set<string>, value: unknown) {
  const normalized = normalizeText(value)
  if (normalized) values.add(normalized)
}

function sortValues(values: Set<string>) {
  return Array.from(values).sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }))
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeDateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  return normalizeText(value).slice(0, 10)
}

function normalizeTimestamp(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  return normalizeText(value)
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'Документ'
}
