import { sql, type SQL } from 'drizzle-orm'
import {
  DOCUMENT_HISTORY_GRID_BLOCK_LIMIT,
  type DocumentHistoryGridRequest,
  type DocumentHistoryGridResult,
  type DocumentHistoryGroupRow,
} from '@/lib/document-history-grid'
import { buildDocumentHistoryWhere } from './document-history-sql'

type GroupKey = ['empty'] | ['multiple'] | ['value', string]

export function normalizeDocumentHistoryGridRequest(
  value: DocumentHistoryGridRequest | undefined,
  allowedKeys: readonly string[],
  idKind: 'generated' | 'system',
): DocumentHistoryGridRequest {
  const startRow = value?.startRow ?? 0
  const endRow = value?.endRow ?? startRow + 100
  if (!Number.isSafeInteger(startRow) || startRow < 0 || !Number.isSafeInteger(endRow)
    || endRow <= startRow || endRow - startRow > DOCUMENT_HISTORY_GRID_BLOCK_LIMIT) {
    throw new Error(`Размер блока документов должен быть от 1 до ${DOCUMENT_HISTORY_GRID_BLOCK_LIMIT}.`)
  }
  const rowGroupCols = value?.rowGroupCols ?? []
  const groupKeys = value?.groupKeys ?? []
  const sortModel = value?.sortModel ?? []
  if (!Array.isArray(rowGroupCols) || rowGroupCols.some(key => !allowedKeys.includes(key))
    || new Set(rowGroupCols).size !== rowGroupCols.length
    || !Array.isArray(groupKeys) || groupKeys.length > rowGroupCols.length
    || !Array.isArray(sortModel) || sortModel.some(item => !item || !allowedKeys.includes(item.colId)
      || !['asc', 'desc'].includes(item.sort)) || new Set(sortModel.map(item => item.colId)).size !== sortModel.length) {
    throw new Error('Некорректная группировка или сортировка реестра документов.')
  }
  const normalizedGroupKeys = groupKeys.map(key => JSON.stringify(parseGroupKey(key)))
  const selectedIds = value?.selectedIds
  if (selectedIds !== undefined && (!Array.isArray(selectedIds) || selectedIds.some(id => !isDocumentId(id, idKind)))) {
    throw new Error('Некорректный выбор документов.')
  }
  if (value?.selectionOnly !== undefined && typeof value.selectionOnly !== 'boolean') throw new Error('Некорректный режим восстановления выбора.')
  if (value?.selectionOnly && (!selectedIds || selectedIds.length > 10_000)) {
    throw new Error('Восстановление выбора поддерживает не более 10000 явно выбранных документов.')
  }
  return {
    startRow, endRow, rowGroupCols: [...rowGroupCols], groupKeys: normalizedGroupKeys,
    sortModel: sortModel.map(({ colId, sort }) => ({ colId, sort })),
    search: String(value?.search ?? '').trim().slice(0, 200),
    ...(selectedIds === undefined ? {} : { selectedIds: [...new Set(selectedIds)] }),
    ...(value?.selectionOnly ? { selectionOnly: true } : {}),
  }
}

function isDocumentId(value: unknown, kind: 'generated' | 'system') {
  if (kind === 'generated') return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647
  if (typeof value !== 'string' || !/^system-document:[1-9]\d*$/.test(value)) return false
  return Number(value.slice('system-document:'.length)) <= 2_147_483_647
}

function parseGroupKey(value: unknown): GroupKey {
  try {
    const key: unknown = typeof value === 'string' ? JSON.parse(value) : null
    if (Array.isArray(key)) {
      if (key.length === 1 && (key[0] === 'empty' || key[0] === 'multiple')) return key as GroupKey
      if (key.length === 2 && key[0] === 'value' && typeof key[1] === 'string' && key[1].trim()) return key as GroupKey
    }
  } catch { /* Reject malformed opaque keys instead of broadening the query. */ }
  throw new Error('Некорректная группа документов.')
}

function field(key: string) {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(key)) throw new Error('Некорректный столбец документов.')
  return sql.identifier(`filter_${key}`)
}

/** Shared with facet options: global search covers registry metadata, never document composition. */
export function buildDocumentHistoryGridSearch(search: string | undefined, filterKeys: readonly string[]) {
  const query = String(search ?? '').trim().slice(0, 200).toLocaleLowerCase('ru-RU')
  return query && filterKeys.length
    ? sql`(${sql.join(filterKeys.map(key => sql`exists (
      select 1 from unnest(coalesce(${field(key)}, array['']::text[])) as "search_value"
      where position(${query} in lower("search_value")) > 0
    )`), sql` or `)})`
    : sql`true`
}

export function withDocumentHistoryGridSearch(baseQuery: SQL, search: string | undefined, filterKeys: readonly string[]) {
  return search?.trim()
    ? sql`select * from (${baseQuery}) as "search_documents" where ${buildDocumentHistoryGridSearch(search, filterKeys)}`
    : baseQuery
}

function groupValue(key: string) {
  // DISTINCT prevents repeated values from creating a false multi-value bucket.
  return sql`array(select distinct btrim("group_value") from unnest(coalesce(${field(key)}, array[]::text[])) as "group_value"
    where nullif(btrim("group_value"), '') is not null order by btrim("group_value"))`
}

function groupKeyExpression(key: string) {
  const values = groupValue(key)
  return sql`case when cardinality(${values}) = 0 then jsonb_build_array('empty'::text)
    when cardinality(${values}) > 1 then jsonb_build_array('multiple'::text)
    else jsonb_build_array('value'::text, (${values})[1]) end`
}

const MULTIPLE_LABELS: Record<string, string> = {
  project: 'Несколько проектов', subtitle: 'Несколько шифров', line: 'Несколько линий', method: 'Несколько методов',
}

export function buildDocumentHistoryGridSql({
  baseQuery, columnFilters, filterKeys, request, idKind, sortExpressions, defaultOrder,
}: {
  baseQuery: SQL
  columnFilters: Record<string, string>
  filterKeys: readonly string[]
  request: DocumentHistoryGridRequest
  idKind: 'generated' | 'system'
  sortExpressions: Record<string, SQL>
  defaultOrder: SQL
}) {
  const idColumn = sql.identifier(idKind === 'system' ? 'documentId' : 'id')
  const groups = request.groupKeys.map((key, index) => sql`${groupKeyExpression(request.rowGroupCols[index])} = ${key}::jsonb`)
  const selectedIds = request.selectedIds?.map(id => idKind === 'system' ? Number(String(id).slice('system-document:'.length)) : Number(id))
  const routeWhere = request.selectionOnly ? sql`${idColumn} = any(${sql.param(selectedIds ?? [])}::integer[])`
    : groups.length ? sql.join(groups, sql` and `) : sql`true`
  const groupColumn = request.selectionOnly ? undefined : request.rowGroupCols[request.groupKeys.length]
  const matchingSelection = selectedIds === undefined ? sql`null::jsonb` : sql`coalesce((
    select jsonb_agg(${idColumn} order by ${idColumn}) from "filtered_documents"
    where ${idColumn} = any(${sql.param(selectedIds)}::integer[])
  ), '[]'::jsonb)`
  const requestedSorts = request.sortModel.map(({ colId, sort }) => {
    const expression = sortExpressions[colId]
    if (!expression) throw new Error('Сортировка этого столбца документов недоступна.')
    return sql`${expression} ${sql.raw(sort)} nulls last`
  })
  const leafOrder = requestedSorts.length
    ? sql`${sql.join(requestedSorts, sql`, `)}, ${idColumn} desc`
    : defaultOrder
  const direction = request.sortModel.find(item => item.colId === groupColumn)?.sort ?? 'asc'
  const groupOrder = sql`"groupSort" ${sql.raw(direction)} nulls last, "groupKey" ${sql.raw(direction)}`
  const levelQuery = groupColumn ? sql`
    select ${groupKeyExpression(groupColumn)} as "groupKey",
      count(*)::integer as "childCount",
      min(${sortExpressions[groupColumn] ?? sql`(${field(groupColumn)})[1]`}) as "groupSort"
    from "scoped_documents" group by ${groupKeyExpression(groupColumn)}
  ` : sql`select * from "scoped_documents"`
  const order = groupColumn ? groupOrder : leafOrder
  return sql`
    with "document_history" as not materialized (${baseQuery}),
    "filtered_documents" as materialized (
      select * from "document_history"
      where ${buildDocumentHistoryWhere(columnFilters, [...filterKeys])}
        and ${buildDocumentHistoryGridSearch(request.search, filterKeys)}
    ),
    "scoped_documents" as not materialized (select * from "filtered_documents" where ${routeWhere}),
    "level_rows" as not materialized (${levelQuery}),
    "block_rows" as materialized (
      select * from "level_rows" order by ${order}
      limit ${request.selectionOnly ? 10_000 : request.endRow - request.startRow} offset ${request.selectionOnly ? 0 : request.startRow}
    )
    select coalesce((select jsonb_agg(to_jsonb("block_rows") order by ${order}) from "block_rows"), '[]'::jsonb) as "rows",
      (select count(*)::integer from "level_rows") as "rowCount",
      (select count(*)::integer from "filtered_documents") as "total",
      ${matchingSelection} as "matchingSelectedIds"
  `
}

export function normalizeDocumentHistoryGridResult<T>(
  raw: unknown,
  request: DocumentHistoryGridRequest,
  idKind: 'generated' | 'system',
  mapDocument: (value: Record<string, unknown>) => T,
): DocumentHistoryGridResult<T> {
  const value = isRecord(raw) ? raw : {}
  const groupColumn = request.selectionOnly ? undefined : request.rowGroupCols[request.groupKeys.length]
  const rows = (Array.isArray(value.rows) ? value.rows : []).filter(isRecord).map(row => {
    if (!groupColumn) return mapDocument(row)
    const groupKey = JSON.stringify(parseGroupKey(JSON.stringify(row.groupKey)))
    const key = parseGroupKey(groupKey)
    const groupLabel = key[0] === 'empty' ? '(пусто)' : key[0] === 'multiple'
      ? MULTIPLE_LABELS[groupColumn] ?? 'Несколько значений' : key[1]
    return {
      __group: true, id: `document-group:${JSON.stringify([request.rowGroupCols.slice(0, request.groupKeys.length + 1), ...request.groupKeys, groupKey])}`,
      groupKey, groupLabel, childCount: Math.max(0, Number(row.childCount) || 0), [groupColumn]: groupLabel,
    } satisfies DocumentHistoryGroupRow
  })
  const matched = new Set((Array.isArray(value.matchingSelectedIds) ? value.matchingSelectedIds : []).map(Number))
  return {
    rows, rowCount: Math.max(0, Number(value.rowCount) || 0), total: Math.max(0, Number(value.total) || 0),
    ...(request.selectedIds === undefined ? {} : {
      matchingSelectedIds: request.selectedIds.filter(id => matched.has(idKind === 'system'
        ? Number(String(id).slice('system-document:'.length)) : Number(id))),
    }),
  }
}

export function documentHistoryTextSort(key: string) {
  return sql`lower(array_to_string(${groupValue(key)}, ', '))`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
