import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { SYSTEM_DOCUMENT_TEMPLATE_PROFILES } from '../src/lib/system-document-template-types'
import { buildDocumentHistoryGridSql, documentHistoryTextSort } from '../src/server/document-history-grid'
import { buildIndexedSystemDocumentHistoryBaseQuery, SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS } from '../src/server/system-document-index'
import type { normalizeSystemDocumentHistoryGridRequest } from '../src/server/system-documents'

// An unoptimized reference for the *current* public registry, separate from
// the fingerprinted pre-composition query. Read the full stored membership in
// joint-ID order, even for single-word searches which production specializes.
function memberNames(alias: string) {
  return sql`coalesce((select array_to_string(array_agg(btrim(j.joint) order by j.id)
    filter (where nullif(btrim(j.joint),'') is not null),' ')
    from generated_document_weld_joints m join weld_joints j on j.id=m.weld_joint_id
    where m.document_id=${sql.identifier(alias)}."documentId"),'')`
}

export function buildFullSystemDocumentGridQuery(request: ReturnType<typeof normalizeSystemDocumentHistoryGridRequest>) {
  const storageTypes = SYSTEM_DOCUMENT_TEMPLATE_PROFILES.filter(profile => profile.documentType === request.type)
    .map(profile => `system:${profile.id}`)
  const source = buildIndexedSystemDocumentHistoryBaseQuery(request.type, storageTypes, request.documentId, true)
  const usesCompositionValues = request.rowGroupCols.includes('jointComposition')
    || request.sortModel.some(field => field.colId === 'jointComposition')
    || !request.selectionOnly && (Boolean(request.columnFilters.jointComposition?.trim()) || request.search?.trim().includes(' '))
  const baseQuery = usesCompositionValues ? sql`select "card".*,array[${memberNames('card')}] as "filter_jointComposition"
    from (${source}) as "card"` : source
  const sortExpressions = Object.fromEntries(SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS.map(key => [key, documentHistoryTextSort(key)]))
  Object.assign(sortExpressions, { rowCount: sql`"rowCount"`, date: sql`nullif("date",'')::date` })
  const compiled = new PgDialect().sqlToQuery(buildDocumentHistoryGridSql({
    baseQuery, columnFilters: request.columnFilters, filterKeys: SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS, request, idKind: 'system',
    searchExpressions: { jointComposition: needle => sql`position(${needle} in lower(${memberNames('document_history')})) > 0` },
    displayColumns: !request.cells || request.cells.columns.includes('jointComposition')
      ? alias => sql`${memberNames(alias)} as "jointComposition"` : undefined,
    populatedExpressions: { jointComposition: sql`nullif("jointComposition",'')` },
    sortExpressions, defaultOrder: sql`"date" desc, "title" desc, "documentId" desc`,
    revisionValue: sql`"documentId"::text || ':' || "documentVersion"`,
    revisionSalt: sql`coalesce((select source_revision::text from derived_calculation_state where id=1),'0')`,
  }))
  return { text: compiled.sql, values: compiled.params }
}
