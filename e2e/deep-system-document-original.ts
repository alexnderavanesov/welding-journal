import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { DocumentHistoryGridRequest } from '../src/lib/document-history-grid'
import type { SystemDocumentType } from '../src/lib/system-document-types'
import { SYSTEM_DOCUMENT_TEMPLATE_PROFILES } from '../src/lib/system-document-template-types'
import { buildDocumentHistoryGridSql, documentHistoryTextSort } from '../src/server/document-history-grid'
import { buildIndexedSystemDocumentHistoryBaseQuery, SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS } from '../src/server/system-document-index'
import fingerprint from './fixtures/system-document-grid-original-fingerprint.json' with { type: 'json' }

/** Reconstruct the pre-optimization query, with no compact projection. The
 * fixed fingerprint below guards against accidentally changing both sides of
 * the differential oracle through their shared base-query implementation. */
export function buildOriginalSystemDocumentGridQuery(
  request: DocumentHistoryGridRequest & { type: SystemDocumentType; documentId?: number; columnFilters: Record<string, string> },
) {
  const storageTypes = SYSTEM_DOCUMENT_TEMPLATE_PROFILES.filter(profile => profile.documentType === request.type)
    .map(profile => `system:${profile.id}`)
  const sortExpressions = Object.fromEntries(SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS.map(key => [key, documentHistoryTextSort(key)]))
  Object.assign(sortExpressions, { rowCount: sql`"rowCount"`, date: sql`nullif("date", '')::date` })
  const query = new PgDialect().sqlToQuery(buildDocumentHistoryGridSql({
    baseQuery: buildIndexedSystemDocumentHistoryBaseQuery(request.type, storageTypes, request.documentId, true),
    columnFilters: request.columnFilters, filterKeys: SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS,
    request, idKind: 'system', sortExpressions,
    defaultOrder: sql`"date" desc, "title" desc, "documentId" desc`,
    revisionValue: sql`"documentId"::text || ':' || "documentVersion"`,
  }))
  return { text: query.sql, values: query.params }
}

export function assertOriginalSystemDocumentGridFingerprint() {
  const query = buildOriginalSystemDocumentGridQuery({ type: 'lnkRequest', columnFilters: {},
    startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] })
  const hash = createHash('sha256').update(query.text.replace(/\s+/g, ' ').trim()).digest('hex')
  assert.equal(hash, fingerprint.sha256, 'Reconstructed original SQL differs from the captured pre-change query')
  assert.deepEqual(query.values, fingerprint.values, 'Original SQL parameters differ from the pre-change capture')
}
