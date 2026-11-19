import { sql, type SQL } from 'drizzle-orm'

// Joint renames need to invalidate a copy/read sequence too, even when no
// document metadata changed. Reuse the existing journal revision, read-only.
export const DOCUMENT_JOINTS_REVISION = sql`coalesce((select source_revision::text from derived_calculation_state where id = 1), '0')`

function documentJointComposition(alias: string, idColumn: 'id' | 'documentId') {
  return sql`(select coalesce(string_agg(nullif(btrim(joint.joint), ''), ' ' order by joint.id), '')
    from generated_document_weld_joints membership
    join weld_joints joint on joint.id = membership.weld_joint_id
    where membership.document_id = ${sql.identifier(alias)}.${sql.identifier(idColumn)})`
}

/** Resolve names only for the requested document block, using its stored membership. */
export function documentJointCompositionColumn(alias: string, idColumn: 'id' | 'documentId') {
  return sql`${documentJointComposition(alias, idColumn)} as "jointComposition"`
}

/** The filter uses the same complete cell text as display/copy. Keep the
 * ordinary registry read cheap unless this value participates in the query. */
export function withDocumentJointCompositionFilter(baseQuery: SQL, idColumn: 'id' | 'documentId', needed: boolean) {
  return needed ? sql`select "composition_source".*,
    array[${documentJointComposition('composition_source', idColumn)}]::text[] as "filter_jointComposition"
    from (${baseQuery}) as "composition_source"` : baseQuery
}

function canSearchIndividualMembers(search: string | undefined) {
  const query = String(search ?? '').trim().slice(0, 200)
  return Boolean(query && !query.includes(' '))
}

/** A substring without the join separator cannot cross two member names.
 * The guard avoids per-document reads when no name matches. OFFSET 0 is a
 * barrier against rewriting this check into repeated global materialization. */
export function documentJointCompositionSearch(query: string, idColumn: 'id' | 'documentId', alias: 'document_history' | 'search_documents'): SQL | undefined {
  if (!canSearchIndividualMembers(query)) return undefined
  return sql`case when exists (
    select 1 from weld_joints search_joint
    where position(${query} in lower(btrim(search_joint.joint))) > 0
  ) then exists (
    select 1 from generated_document_weld_joints membership
    join weld_joints joint on joint.id = membership.weld_joint_id
    where membership.document_id = ${sql.identifier(alias)}.${sql.identifier(idColumn)}
      and position(${query} in lower(btrim(joint.joint))) > 0
    offset 0
  ) else false end`
}

export function needsDocumentJointCompositionFilter(request: {
  search?: string; columnFilters?: Record<string, string>; fieldKey?: string;
  rowGroupCols?: readonly string[]; sortModel?: readonly { colId: string }[]; selectionOnly?: boolean;
}) {
  return Boolean(request.rowGroupCols?.includes('jointComposition')
    || request.sortModel?.some(sort => sort.colId === 'jointComposition')
    || !request.selectionOnly && (request.search?.trim() && !canSearchIndividualMembers(request.search) || request.columnFilters?.jointComposition?.trim()
      || request.fieldKey === 'jointComposition'))
}
