import { sql, type SQL } from 'drizzle-orm'

import { parseWeldColumnChoiceFilter } from '@/lib/weld-column-choice-filter'

export type SqlDocumentHistoryFilterOption = {
  value: string
  label: string
  count: number
}

export type SqlDocumentHistoryResult<TDocument> = {
  documents: TDocument[]
  total: number
  filterOptions: Record<string, SqlDocumentHistoryFilterOption[]>
}

export function buildDocumentHistorySqlQuery({
  baseQuery,
  columnFilters,
  filterKeys,
  limit,
  orderBy,
}: {
  baseQuery: SQL
  columnFilters: Record<string, string>
  filterKeys: string[]
  limit: number
  orderBy: SQL
}) {
  const filteredWhere = buildDocumentHistoryWhere(columnFilters, filterKeys)
  const filterOptionEntries = filterKeys.flatMap((key) => [
    sql`${key}::text`,
    buildDocumentHistoryFilterOptionsQuery({ columnFilters, filterKeys, key }),
  ])

  return sql`
    with "document_history" as materialized (
      ${baseQuery}
    ),
    "filtered_documents" as materialized (
      select *
      from "document_history"
      where ${filteredWhere}
    ),
    "paged_documents" as (
      select *
      from "filtered_documents"
      order by ${orderBy}
      limit ${limit}
    )
    select
      coalesce(
        (
          select jsonb_agg(to_jsonb("page_document") order by ${orderBy})
          from "paged_documents" as "page_document"
        ),
        '[]'::jsonb
      ) as "documents",
      (select count(*)::integer from "filtered_documents") as "total",
      jsonb_build_object(${sql.join(filterOptionEntries, sql`, `)}) as "filterOptions"
  `
}

export function normalizeSqlDocumentHistoryResult<TDocument>(
  row: unknown,
  filterKeys: string[],
  mapDocument: (value: Record<string, unknown>) => TDocument,
): SqlDocumentHistoryResult<TDocument> {
  const rawRow = isRecord(row) ? row : {}
  const rawDocuments = Array.isArray(rawRow.documents) ? rawRow.documents : []
  const rawFilterOptions = isRecord(rawRow.filterOptions) ? rawRow.filterOptions : {}
  return {
    documents: rawDocuments.filter(isRecord).map(mapDocument),
    total: Math.max(0, Number(rawRow.total) || 0),
    filterOptions: Object.fromEntries(
      filterKeys.map((key) => [
        key,
        normalizeFilterOptions(rawFilterOptions[key]),
      ]),
    ),
  }
}

function buildDocumentHistoryFilterOptionsQuery({
  columnFilters,
  filterKeys,
  key,
}: {
  columnFilters: Record<string, string>
  filterKeys: string[]
  key: string
}) {
  const where = buildDocumentHistoryWhere(columnFilters, filterKeys, key)
  const valueColumn = getHistoryFilterColumn(key, 'option_document')
  return sql`
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'value', "option_count"."value",
            'label', case when "option_count"."value" = '' then '(пусто)' else "option_count"."value" end,
            'count', "option_count"."count"
          )
        )
        from (
          select
            "option_value"."value",
            count(*)::integer as "count"
          from "document_history" as "option_document"
          cross join lateral (
            select distinct btrim("raw_value") as "value"
            from unnest(coalesce(${valueColumn}, array['']::text[])) as "raw_value"
          ) as "option_value"
          where ${where}
          group by "option_value"."value"
        ) as "option_count"
      ),
      '[]'::jsonb
    )
  `
}

function buildDocumentHistoryWhere(
  columnFilters: Record<string, string>,
  filterKeys: string[],
  omittedKey?: string,
) {
  const supportedKeys = new Set(filterKeys)
  const predicates = Object.entries(columnFilters).flatMap(([key, value]) => {
    if (key === omittedKey || !value.trim()) return []
    if (!supportedKeys.has(key)) return [sql`false`]
    return [buildDocumentHistoryFilterPredicate(getHistoryFilterColumn(key), value)]
  })
  return predicates.length > 0 ? sql.join(predicates, sql` and `) : sql`true`
}

function buildDocumentHistoryFilterPredicate(column: SQL, rawFilter: string) {
  const choiceFilter = parseWeldColumnChoiceFilter(rawFilter)
  if (choiceFilter?.kind === 'values') {
    if (choiceFilter.values.length === 0) return sql`false`
    const choices = choiceFilter.values.map((value) => value.trim().toLocaleLowerCase('ru-RU'))
    const choicePredicates = choices.map((value) => sql`lower(btrim("filter_value")) = ${value}`)
    return sql`exists (
      select 1
      from unnest(coalesce(${column}, array['']::text[])) as "filter_value"
      where ${sql.join(choicePredicates, sql` or `)}
    )`
  }

  const query = rawFilter.trim().toLocaleLowerCase('ru-RU')
  return sql`exists (
    select 1
    from unnest(coalesce(${column}, array['']::text[])) as "filter_value"
    where position(${query} in lower("filter_value")) > 0
  )`
}

function getHistoryFilterColumn(key: string, tableAlias?: string) {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(key)) {
    throw new Error(`Некорректный ключ фильтра истории: ${key}`)
  }
  const columnName = `filter_${key}`
  return tableAlias
    ? sql.raw(`"${tableAlias}"."${columnName}"`)
    : sql.raw(`"${columnName}"`)
}

function normalizeFilterOptions(value: unknown): SqlDocumentHistoryFilterOption[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .map((option) => {
      const normalizedValue = String(option.value ?? '').trim()
      return {
        value: normalizedValue,
        label: normalizedValue || '(пусто)',
        count: Math.max(0, Number(option.count) || 0),
      }
    })
    .sort(compareFilterOptions)
}

function compareFilterOptions(
  left: SqlDocumentHistoryFilterOption,
  right: SqlDocumentHistoryFilterOption,
) {
  if (left.value === '') return -1
  if (right.value === '') return 1
  const leftNumber = Number(left.value.replace(',', '.'))
  const rightNumber = Number(right.value.replace(',', '.'))
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber
  return left.label.localeCompare(right.label, 'ru', { numeric: true, sensitivity: 'base' })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
