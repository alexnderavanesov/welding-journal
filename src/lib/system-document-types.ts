import type { WeldRow } from '@/lib/dispatcher-types'
import { getBusinessDateIso } from '@/lib/business-date'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import {
  REQUEST_CONCLUSION_DEFAULT_SETTINGS,
  addRowsToNamingPatternContext,
  buildSystemNameWithNumber,
  extractSystemNameNumber,
  getPstoConclusionDateParts,
  type RequestConclusionSettings,
} from '@/lib/request-conclusion-settings'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export const SYSTEM_DOCUMENT_TYPES = [
  'lnkRequest',
  'lnkConclusion',
  'pstoRequest',
  'pstoConclusion',
] as const

export type SystemDocumentType = (typeof SYSTEM_DOCUMENT_TYPES)[number]
export type SystemDocumentTargetReport = 'lnk' | 'heatTreatment'

export type SystemDocumentReference = {
  documentId?: number
  type: SystemDocumentType
  title: string
  date: string
  methodCode?: string
}

export type SystemDocumentNavigationRequest = SystemDocumentReference & {
  requestId: number
}

export type SystemDocumentSummary = SystemDocumentReference & {
  id: string
  documentId: number
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
  rowIds: number[]
}

export type SystemDocumentTemplateContext = {
  type: SystemDocumentType
  label: string
  title: string
  date: string
  number: string
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

export function getSystemDocumentTargetReport(
  type: SystemDocumentType,
): SystemDocumentTargetReport {
  return type === 'lnkRequest' || type === 'lnkConclusion' ? 'lnk' : 'heatTreatment'
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
  const documentId = row.systemDocumentIds?.[fieldKey]
  const requestMethod = LNK_REQUEST_METHOD_BY_FIELD.get(fieldKey)
  if (requestMethod) {
    return createReference({
      documentId,
      type: 'lnkRequest',
      title: row[requestMethod.requestKey],
      date: row[requestMethod.requestDateKey],
    })
  }

  const conclusionMethod = LNK_CONCLUSION_METHOD_BY_FIELD.get(fieldKey)
  if (conclusionMethod) {
    return createReference({
      documentId,
      type: 'lnkConclusion',
      title: row[conclusionMethod.conclusionKey],
      date: row[conclusionMethod.conclusionDateKey],
      methodCode: conclusionMethod.code,
    })
  }

  if (fieldKey === 'pstoRequest') {
    return createReference({
      documentId,
      type: 'pstoRequest',
      title: row.pstoRequest,
      date: row.pstoRequestDate,
    })
  }

  if (fieldKey === 'heatTreatmentDiagram') {
    return createReference({
      documentId,
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
  reference: SystemDocumentReference | SystemDocumentSummary,
  methodCodes: string[] = reference.methodCode ? [reference.methodCode] : [],
  settings: RequestConclusionSettings = REQUEST_CONCLUSION_DEFAULT_SETTINGS,
): SystemDocumentTemplateContext {
  return {
    ...reference,
    label: getSystemDocumentProfile(reference.type).label,
    number: getSystemDocumentNumber(reference, settings),
    methodCodes,
  }
}

export function getSystemDocumentNumber(
  reference: SystemDocumentReference | SystemDocumentSummary,
  settings: RequestConclusionSettings = REQUEST_CONCLUSION_DEFAULT_SETTINGS,
) {
  const candidates = getSystemDocumentRawNumberCandidates(reference, settings)
    .map((number) => Number(number))
    .filter((number) => Number.isSafeInteger(number) && number > 0)
    .sort((left, right) => left - right)
  const number = candidates[0]
  return number ? String(number).padStart(3, '0') : ''
}

function getSystemDocumentRawNumberCandidates(
  reference: SystemDocumentReference | SystemDocumentSummary,
  settings: RequestConclusionSettings,
) {
  const date = reference.date
    ? new Date(`${reference.date}T00:00:00`)
    : new Date()
  const baseContext = reference.type === 'pstoConclusion'
    ? getPstoConclusionDateParts(reference.date)
    : { date, methodCode: reference.methodCode }
  const context = 'projects' in reference
    ? {
        ...baseContext,
        projectTitle: reference.projects.join(', '),
        subtitleCode: reference.subtitleCodes.join(', '),
        line: reference.lines.join(', '),
      }
    : baseContext
  const namingSettings = settings[reference.type]
  const patterns = Array.from(
    new Set([
      namingSettings.systemPattern,
      ...(namingSettings.systemPatternHistory ?? []),
      REQUEST_CONCLUSION_DEFAULT_SETTINGS[reference.type].systemPattern,
    ]),
  )
  const candidates = patterns
    .map((pattern) => extractSystemNameNumber(pattern, context, reference.title))
    .filter((number) => /^\d+$/.test(number))
  return candidates
}

export function getSystemDocumentRenameNumber(
  reference: SystemDocumentReference | SystemDocumentSummary,
  settings: RequestConclusionSettings,
  nextNumber: number,
) {
  const normalizedNextNumber = Math.max(1, Math.floor(nextNumber))
  const expectedWidth = Math.max(3, String(Math.max(1, normalizedNextNumber - 1)).length)
  const candidates = getSystemDocumentRawNumberCandidates(reference, settings)
    .flatMap((rawNumber) => {
      const parsedNumber = Number(rawNumber)
      if (parsedNumber < normalizedNextNumber) return [parsedNumber]

      for (let length = Math.min(expectedWidth, rawNumber.length - 1); length >= 1; length -= 1) {
        const candidate = Number(rawNumber.slice(0, length))
        if (Number.isSafeInteger(candidate) && candidate > 0 && candidate < normalizedNextNumber) {
          return [candidate]
        }
      }
      return rawNumber.length <= expectedWidth ? [parsedNumber] : []
    })
    .filter((number) => Number.isSafeInteger(number) && number > 0)
    .sort((left, right) => left - right)

  return candidates[0] ? String(candidates[0]).padStart(3, '0') : ''
}

export function isSystemDocumentNameForRows(
  rows: Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>,
  type: SystemDocumentType,
  title: string,
  settings: RequestConclusionSettings = REQUEST_CONCLUSION_DEFAULT_SETTINGS,
) {
  const normalizedTitle = title.trim()
  if (!normalizedTitle) return false
  return buildSystemDocumentSummaries(rows, type).some(
    (summary) =>
      summary.title === normalizedTitle &&
      Boolean(getSystemDocumentNumber(summary, settings)),
  )
}

export function buildCurrentSystemDocumentName(
  reference: SystemDocumentReference | SystemDocumentSummary,
  rows: Array<Partial<Pick<WeldRow, 'projectTitle' | 'subtitleCode' | 'line'>>>,
  settings: RequestConclusionSettings,
  number: number,
) {
  const baseContext = reference.type === 'pstoConclusion'
    ? getPstoConclusionDateParts(reference.date)
    : {
        date: reference.date ? new Date(`${reference.date}T00:00:00`) : new Date(),
        methodCode: reference.methodCode,
      }
  return buildSystemNameWithNumber(
    settings[reference.type].systemPattern,
    addRowsToNamingPatternContext(baseContext, rows),
    number,
  )
}

export function buildSystemDocumentRenameRows(
  reference: SystemDocumentReference,
  rows: WeldRow[],
  nextName: string,
) {
  const fieldKeys = new Set<WeldFieldKey>()
  const records = rows.flatMap((row) => {
    let nextRow: WeldRow | null = null
    const renameField = (fieldKey: WeldFieldKey, dateKey: WeldFieldKey) => {
      if (normalizeText(row[fieldKey]) !== reference.title) return
      if (normalizeDateValue(row[dateKey]) !== reference.date) return
      nextRow = { ...(nextRow ?? row), [fieldKey]: nextName }
      fieldKeys.add(fieldKey)
    }

    if (reference.type === 'lnkRequest') {
      for (const method of LNK_METHODS) renameField(method.requestKey, method.requestDateKey)
    } else if (reference.type === 'lnkConclusion') {
      const method = LNK_METHODS.find((candidate) => candidate.code === reference.methodCode)
      if (method) renameField(method.conclusionKey, method.conclusionDateKey)
    } else if (reference.type === 'pstoRequest') {
      renameField('pstoRequest', 'pstoRequestDate')
    } else {
      renameField('heatTreatmentDiagram', 'pstoDate')
    }

    return nextRow ? [nextRow] : []
  })

  return {
    records,
    fieldKeys: Array.from(fieldKeys),
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
  if (reference.documentId) return `system-document:${reference.documentId}`
  return JSON.stringify([
    reference.type,
    reference.title,
    reference.date,
    reference.methodCode ?? '',
  ])
}

function createReference({
  documentId,
  type,
  title,
  date,
  methodCode,
}: {
  documentId?: number
  type: SystemDocumentType
  title: unknown
  date: unknown
  methodCode?: string
}): SystemDocumentReference | null {
  const normalizedTitle = normalizeText(title)
  if (!normalizedTitle) return null
  return {
    ...(Number(documentId) > 0 ? { documentId: Number(documentId) } : {}),
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
    documentId: group.documentId ?? 0,
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
    rowIds: Array.from(group.rowIds).sort((left, right) => left - right),
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
    return getBusinessDateIso(value)
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
