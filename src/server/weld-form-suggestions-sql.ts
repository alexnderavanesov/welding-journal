import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'

import { weldJoints } from '@/db/schema'
import {
  FIELD_BY_KEY,
  type WeldFieldKey,
  type WeldInput,
} from '@/lib/weld-fields'
import {
  getWeldFormSuggestionSourceFieldKeys,
  normalizeWeldFormSuggestionText,
  normalizeWeldFormSuggestionValue,
  type WeldFormSuggestion,
} from '@/lib/weld-form-suggestions'
import { getWeldColumn } from '@/server/weld-server-shared'

const CONTEXT_FIELDS: WeldFieldKey[] = ['projectTitle', 'subtitleCode', 'line', 'joint']
const MATCH_CONTEXT_FIELDS: Array<{ key: WeldFieldKey; score: number }> = [
  { key: 'projectTitle', score: 40 },
  { key: 'subtitleCode', score: 36 },
  { key: 'line', score: 34 },
  { key: 'groupName', score: 20 },
  { key: 'category', score: 20 },
  { key: 'isometry', score: 14 },
  { key: 'spool', score: 14 },
  { key: 'element1', score: 12 },
  { key: 'element2', score: 12 },
  { key: 'material1', score: 10 },
  { key: 'material2', score: 10 },
]

export function buildWeldFormSuggestionsQuery({
  fieldKey,
  draft,
  limit = 8,
}: {
  fieldKey: WeldFieldKey
  draft: WeldInput
  limit?: number
}): SQL | null {
  const sourceExpressions = getWeldFormSuggestionSourceFieldKeys(fieldKey).flatMap(
    (sourceFieldKey, sourceOrder) => {
      const column = getWeldColumn(sourceFieldKey)
      return column
        ? [sql`(${buildNormalizedColumnText(sourceFieldKey, column)}, ${sourceOrder})`]
        : []
    },
  )
  if (sourceExpressions.length === 0) return null

  const query = normalizeWeldFormSuggestionText(draft[fieldKey])
  const contextExpression = buildSuggestionContextExpression(fieldKey)
  const scoreExpression = buildSuggestionScoreExpression(draft)
  const currentId = typeof draft.id === 'number' && Number.isInteger(draft.id)
    ? draft.id
    : null
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)))

  return sql`
    with "suggestion_candidates" as materialized (
      select
        "suggestion_source"."value",
        ${contextExpression} as "context",
        ${scoreExpression} as "score",
        ${weldJoints.createdAt} as "created_at",
        "suggestion_source"."source_order"
      from ${weldJoints}
      cross join lateral (
        values ${sql.join(sourceExpressions, sql`, `)}
      ) as "suggestion_source"("value", "source_order")
      where "suggestion_source"."value" <> ''
        and "suggestion_source"."value" <> '-'
        ${currentId === null ? sql`` : sql`and ${weldJoints.id} <> ${currentId}`}
        ${query ? sql`and strpos(lower("suggestion_source"."value"), ${query}) > 0` : sql``}
    )
    select
      "value",
      coalesce(
        (
          array_agg("context" order by "created_at" desc, "source_order" asc)
          filter (where "context" <> '')
        )[1],
        ''
      )::text as "context",
      count(*)::integer as "count",
      max("score")::integer as "score"
    from "suggestion_candidates"
    group by "value"
    order by max("score") desc, count(*) desc, "value" asc
    limit ${safeLimit}
  `
}

export function normalizeWeldFormSuggestionRows(
  rows: Array<{
    value: unknown
    context: unknown
    count: number | string
    score: number | string
  }>,
): WeldFormSuggestion[] {
  return rows.flatMap((row) => {
    const value = normalizeWeldFormSuggestionValue(row.value)
    if (!value) return []
    return [{
      value,
      context: normalizeWeldFormSuggestionValue(row.context),
      count: Number(row.count) || 0,
      score: Number(row.score) || 0,
    }]
  })
}

function buildSuggestionScoreExpression(draft: WeldInput) {
  const scoreTerms = MATCH_CONTEXT_FIELDS.flatMap(({ key, score }) => {
    const draftValue = normalizeWeldFormSuggestionText(draft[key])
    const column = getWeldColumn(key)
    if (!draftValue || !column) return []
    return [sql`case when lower(${buildNormalizedColumnText(key, column)}) = ${draftValue} then ${score} else 0 end`]
  })
  return scoreTerms.length > 0
    ? sql<number>`${sql.join(scoreTerms, sql` + `)}`
    : sql<number>`0`
}

function buildSuggestionContextExpression(fieldKey: WeldFieldKey) {
  const values = CONTEXT_FIELDS.flatMap((key) => {
    if (key === fieldKey) return []
    const column = getWeldColumn(key)
    if (!column) return []
    const normalized = buildNormalizedColumnText(key, column)
    return [sql`nullif(nullif(${normalized}, ''), '-')`]
  })
  return values.length > 0
    ? sql<string>`concat_ws(' · ', ${sql.join(values, sql`, `)})`
    : sql<string>`''`
}

function buildNormalizedColumnText(fieldKey: WeldFieldKey, column: SQLWrapper) {
  const field = FIELD_BY_KEY.get(fieldKey)
  const text = field?.kind === 'number'
    ? sql<string>`case
        when ${column} is null then ''
        else to_char(${column}::numeric, 'FM999999999999999999990.###')
      end`
    : sql<string>`coalesce(${column}::text, '')`
  return sql<string>`btrim(regexp_replace(${text}, '[[:space:]]+', ' ', 'g'))`
}
