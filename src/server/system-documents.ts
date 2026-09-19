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
  type RemoteDocumentHistoryFilterOption,
} from '@/server/generated-documents'
import {
  loadSystemDocumentDateContext,
  loadIndexedSystemDocumentHistory,
  loadSystemDocumentRows,
  loadSystemDocumentSummaries,
} from '@/server/system-document-index'
import { assertSecurityScope } from '@/server/security-functions'

export type RemoteSystemDocumentHistoryRequest = {
  type: SystemDocumentType
  documentId?: number
  limit?: number
  columnFilters?: Record<string, string>
}

export type RemoteSystemDocumentHistoryResult = {
  documents: SystemDocumentSummary[]
  total: number
  filterOptions: Record<string, RemoteDocumentHistoryFilterOption[]>
}

export const listSystemDocuments = createServerFn({ method: 'GET' })
  .validator((data: { type: SystemDocumentType }) => ({
    type: requireSystemDocumentType(data?.type),
  }))
  .handler(async ({ data }): Promise<SystemDocumentSummary[]> => {
    await assertSecurityScope('entry')
    return loadSystemDocumentSummaries(data.type)
  })

export const listSystemDocumentHistory = createServerFn({ method: 'GET' })
  .validator(normalizeSystemDocumentHistoryRequest)
  .handler(async ({ data }): Promise<RemoteSystemDocumentHistoryResult> => {
    await assertSecurityScope('entry')
    return loadIndexedSystemDocumentHistory({
      type: data.type,
      documentId: data.documentId,
      columnFilters: data.columnFilters,
      limit: data.limit,
    })
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

export const getSystemDocumentRows = createServerFn({ method: 'GET' })
  .validator(normalizeSystemDocumentReference)
  .handler(async ({ data }): Promise<WeldRow[]> => {
    await assertSecurityScope('entry')
    return loadSystemDocumentRows(data)
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
