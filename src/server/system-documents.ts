import { createServerFn } from '@tanstack/react-start'

import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import {
  isSystemDocumentType,
  type SystemDocumentReference,
  type SystemDocumentSummary,
  type SystemDocumentType,
} from '@/lib/system-document-types'
import {
  normalizeDocumentHistoryColumnFilters,
  normalizeDocumentHistoryLimit,
  type RemoteDocumentHistoryFilterOption,
} from '@/server/generated-documents'
import {
  loadIndexedSystemDocumentHistory,
  loadSystemDocumentRows,
  loadSystemDocumentSummaries,
} from '@/server/system-document-index'
import { assertSecurityScope } from '@/server/security-functions'

export type RemoteSystemDocumentHistoryRequest = {
  type: SystemDocumentType
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
  .validator((data: RemoteSystemDocumentHistoryRequest | undefined) => ({
    type: requireSystemDocumentType(data?.type),
    limit: normalizeDocumentHistoryLimit(data?.limit),
    columnFilters: normalizeDocumentHistoryColumnFilters(data?.columnFilters),
  }))
  .handler(async ({ data }): Promise<RemoteSystemDocumentHistoryResult> => {
    await assertSecurityScope('entry')
    return loadIndexedSystemDocumentHistory({
      type: data.type,
      columnFilters: data.columnFilters,
      limit: data.limit,
    })
  })

export const getSystemDocumentRows = createServerFn({ method: 'GET' })
  .validator(normalizeSystemDocumentReference)
  .handler(async ({ data }): Promise<WeldRow[]> => {
    await assertSecurityScope('entry')
    return loadSystemDocumentRows(data)
  })

function requireSystemDocumentType(value: unknown): SystemDocumentType {
  if (!isSystemDocumentType(value)) throw new Error('Неизвестный тип системного документа.')
  return value
}

function normalizeSystemDocumentReference(data: SystemDocumentReference): SystemDocumentReference {
  const type = requireSystemDocumentType(data?.type)
  const title = String(data?.title ?? '').trim()
  const date = String(data?.date ?? '').trim().slice(0, 10)
  const methodCode = String(data?.methodCode ?? '').trim()
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
  }
}
