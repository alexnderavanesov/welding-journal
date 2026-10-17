import { createServerFn } from '@tanstack/react-start'

import type { WeldRow } from '@/lib/dispatcher-types'
import { ALL_LNK_FIELD_METHODS as LNK_METHODS } from '@/lib/lnk-report-config'
import {
  isSystemDocumentSourceKind,
  isSystemDocumentType,
  type SystemDocumentReference,
  type SystemDocumentSummary,
  type SystemDocumentType,
} from '@/lib/system-document-types'
import {
  normalizeDocumentHistoryColumnFilters,
  normalizeDocumentHistoryDocumentId,
  normalizeDocumentHistoryLimit,
} from '@/server/generated-documents'
import {
  isSystemDocumentHistoryFilterKey,
  hasSystemDocumentNameConflict,
  loadSystemDocumentDateContext,
  loadIndexedSystemDocumentHistoryFilterOptions,
  loadIndexedSystemDocumentHistoryGrid,
  SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS,
  loadSystemDocumentRows,
  loadSystemDocumentSpecialistSnapshot,
} from '@/server/system-document-index'
import type { SqlDocumentHistoryFilterOptionsResult } from '@/server/document-history-sql'
import { assertSecurityScope } from '@/server/security-functions'
import type { DocumentHistoryGridRequest, DocumentHistoryGridResult } from '@/lib/document-history-grid'
import { normalizeDocumentHistoryGridRequest } from './document-history-grid'

export type RemoteSystemDocumentHistoryRequest = {
  type: SystemDocumentType
  documentId?: number
  limit?: number
  columnFilters?: Record<string, string>
}

export type RemoteSystemDocumentHistoryFilterOptionsRequest = {
  type: SystemDocumentType
  documentId?: number
  fieldKey: string
  search?: string
  gridSearch?: string
  columnFilters?: Record<string, string>
}

export type RemoteSystemDocumentHistoryGridRequest = Omit<RemoteSystemDocumentHistoryRequest, 'limit'> & DocumentHistoryGridRequest

export const listSystemDocumentHistoryGrid = createServerFn({ method: 'POST' })
  .validator(normalizeSystemDocumentHistoryGridRequest)
  .handler(async ({ data }): Promise<DocumentHistoryGridResult<SystemDocumentSummary>> => {
    await assertSecurityScope('entry')
    return loadIndexedSystemDocumentHistoryGrid(data)
  })

export function normalizeSystemDocumentHistoryGridRequest(data: RemoteSystemDocumentHistoryGridRequest | undefined) {
  const { limit: _limit, ...history } = normalizeSystemDocumentHistoryRequest(data)
  return { ...history, ...normalizeDocumentHistoryGridRequest(data, SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS, 'system') }
}

export type RemoteSystemDocumentNameConflictRequest = {
  type: SystemDocumentType
  title: string
  date: string
  methodCode?: string
  excludeDocumentId?: number
}

export const checkSystemDocumentNameConflict = createServerFn({ method: 'POST' })
  .validator(normalizeSystemDocumentNameConflictRequest)
  .handler(async ({ data }): Promise<boolean> => {
    await assertSecurityScope('entry')
    return hasSystemDocumentNameConflict(data)
  })

export const listSystemDocumentHistoryFilterOptions = createServerFn({ method: 'GET' })
  .validator(normalizeSystemDocumentHistoryFilterOptionsRequest)
  .handler(async ({ data }): Promise<SqlDocumentHistoryFilterOptionsResult> => {
    await assertSecurityScope('entry')
    return loadIndexedSystemDocumentHistoryFilterOptions(data)
  })

export function normalizeSystemDocumentHistoryRequest(
  data: RemoteSystemDocumentHistoryRequest | undefined,
) {
  const documentId = normalizeDocumentHistoryDocumentId(data?.documentId)
  return {
    type: requireSystemDocumentType(data?.type),
    ...(documentId ? { documentId } : {}),
    limit: normalizeDocumentHistoryLimit(data?.limit),
    columnFilters: normalizeDocumentHistoryColumnFilters(data?.columnFilters),
  }
}

export function normalizeSystemDocumentHistoryFilterOptionsRequest(
  data: RemoteSystemDocumentHistoryFilterOptionsRequest | undefined,
) {
  if (!isSystemDocumentHistoryFilterKey(data?.fieldKey)) {
    throw new Error('Неизвестный столбец фильтра истории документов.')
  }
  const documentId = normalizeDocumentHistoryDocumentId(data?.documentId)
  return {
    type: requireSystemDocumentType(data?.type),
    ...(documentId ? { documentId } : {}),
    fieldKey: data.fieldKey,
    search: String(data?.search ?? '').trim().slice(0, 200),
    ...(data?.gridSearch === undefined ? {} : { gridSearch: String(data.gridSearch).trim().slice(0, 200) }),
    columnFilters: normalizeDocumentHistoryColumnFilters(data?.columnFilters),
  }
}

export function normalizeSystemDocumentNameConflictRequest(
  data: RemoteSystemDocumentNameConflictRequest | undefined,
) {
  const excludeDocumentId = Math.floor(Number(data?.excludeDocumentId))
  return {
    type: requireSystemDocumentType(data?.type),
    title: String(data?.title ?? '').trim(),
    date: String(data?.date ?? '').trim().slice(0, 10),
    ...(String(data?.methodCode ?? '').trim()
      ? { methodCode: String(data?.methodCode ?? '').trim() }
      : {}),
    ...(Number.isInteger(excludeDocumentId) && excludeDocumentId > 0
      ? { excludeDocumentId }
      : {}),
  }
}

export const getSystemDocumentRows = createServerFn({ method: 'GET' })
  .validator(normalizeSystemDocumentReference)
  .handler(async ({ data }): Promise<WeldRow[]> => {
    await assertSecurityScope('entry')
    return loadSystemDocumentRows(data)
  })

export const getSystemDocumentSpecialists = createServerFn({ method: 'GET' })
  .validator(normalizeSystemDocumentReference)
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    return loadSystemDocumentSpecialistSnapshot(data)
  })

export const getSystemDocumentDateContext = createServerFn({ method: 'GET' })
  .validator(normalizeSystemDocumentReference)
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    return loadSystemDocumentDateContext(data)
  })

function requireSystemDocumentType(value: unknown): SystemDocumentType {
  if (!isSystemDocumentType(value)) throw new Error('Неизвестный тип системного документа.')
  return value
}

export function normalizeSystemDocumentReference(data: SystemDocumentReference): SystemDocumentReference {
  const type = requireSystemDocumentType(data?.type)
  const title = String(data?.title ?? '').trim()
  const date = String(data?.date ?? '').trim().slice(0, 10)
  const methodCode = String(data?.methodCode ?? '').trim()
  const rawSourceKind = String(data?.sourceKind ?? '').trim()
  if (rawSourceKind && !isSystemDocumentSourceKind(rawSourceKind)) {
    throw new Error('Неизвестный этап системного документа.')
  }
  const sourceKind = isSystemDocumentSourceKind(rawSourceKind) ? rawSourceKind : undefined
  const cycleSequences = [...new Set((Array.isArray(data?.cycleSequences) ? data.cycleSequences : [])
    .map((value) => Math.floor(Number(value)))
    .filter((value) => Number.isInteger(value) && value > 0))]
    .sort((left, right) => left - right)
  if (!title) throw new Error('Не указано наименование системного документа.')
  if (type === 'lnkConclusion' && !LNK_METHODS.some((method) => method.code === methodCode)) {
    throw new Error('Не указан вид контроля заключения ЛНК.')
  }
  return {
    ...(Number(data?.documentId) > 0 ? { documentId: Math.floor(Number(data.documentId)) } : {}),
    type,
    title,
    date,
    ...(methodCode ? { methodCode } : {}),
    ...(sourceKind ? { sourceKind } : {}),
    ...(cycleSequences.length > 0 ? { cycleSequences } : {}),
  }
}
