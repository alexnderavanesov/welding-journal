import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { expect } from '@playwright/test'
import { PgDialect } from 'drizzle-orm/pg-core'
import pg, { type Client } from 'pg'
import { buildWeldColumnValueFilter } from '../src/lib/weld-column-choice-filter'
import { buildWeldDateColumnWhere } from '../src/server/weld-server-shared'

export type Query = { sql: string; params: unknown[] }

const dateColumn = '"weld_joints"."weld_date"'
const normalizedDate = `lower(trim(coalesce(${dateColumn}::text, '')))`
type OldDateKind = 'values' | 'exact' | 'contains'
export type NativeDate = { dates: string[]; empty: boolean }

// Frozen historical expression; do not obtain the oracle from the candidate
// builder. Current boolean queries below use the real production builder.
export function originalDate(kind: OldDateKind, values: string[]): Query {
  if (kind === 'values') {
    if (!values.length) return { sql: 'false', params: [] }
    return { sql: `${normalizedDate} = any(array[${values.map((_, i) => `lower(trim($${i + 1}))`).join(', ')}]::text[])`, params: [...values] }
  }
  assert.equal(values.length, 1)
  return kind === 'exact' ? { sql: `${normalizedDate} = lower(trim($1))`, params: [...values] }
    : { sql: `coalesce(${dateColumn}::text, '') ilike $1`, params: [`%${values[0]}%`] }
}

/** Frozen C5 expression, independent of the current production builder. */
export function previousNativeDate(old: Query, native?: NativeDate): Query {
  if (!native) return { sql: old.sql, params: [...old.params] }
  assert(native.dates.length > 0 || native.empty)
  const nativeMatch = native.dates.length ? `${dateColumn} = any($${old.params.length + 1}::date[])` : ''
  const previousNative = nativeMatch ? native.empty ? `(${nativeMatch} or ${dateColumn} is null)` : nativeMatch : `${dateColumn} is null`
  return { sql: `(${old.sql} and ${previousNative})`, params: [...old.params, ...(native.dates.length ? [native.dates] : [])] }
}

export const booleanDates = [null, '2026-10-03', '2024-02-29', '2026-02-28', '1900-02-28', '2000-02-29',
  '0001-01-01', '0099-12-31', '9999-12-31', '10000-01-01', '0001-01-01 BC', 'infinity', '-infinity', '2026-03-10']
// Four output families, including order settings that can change the old text
// result. ISO,YMD must also take the runtime ISO branch correctly.
export const booleanStyles = ['ISO, MDY', 'ISO, DMY', 'ISO, YMD', 'SQL, MDY', 'SQL, DMY', 'German, DMY', 'Postgres, MDY', 'Postgres, DMY']
type BooleanCase = { name: string; filter: string; old: Query; native?: NativeDate; expected: (style: string) => number[] }
const isoIds = (ids: number[]) => (style: string) => style.startsWith('ISO') ? ids : []

function booleanCases(): BooleanCase[] {
  const choice = (name: string, values: string[], ids: number[], native?: NativeDate): BooleanCase => ({ name,
    filter: buildWeldColumnValueFilter(values), old: originalDate('values', values), native, expected: isoIds(ids) })
  const exact = (name: string, filter: string, value: string, ids: number[], native?: NativeDate): BooleanCase => ({ name,
    filter, old: originalDate('exact', [value]), native, expected: isoIds(ids) })
  return [
    { name: 'decoded empty choice is FALSE', filter: '__column_choice_filter__:' + encodeURIComponent(JSON.stringify({ kind: 'values', values: [] })),
      old: originalDate('values', []), expected: () => [] },
    choice('one canonical day', ['2026-10-03'], [2], { dates: ['2026-10-03'], empty: false }),
    choice('multiple canonical days', ['2026-10-03', '2024-02-29'], [2, 3], { dates: ['2026-10-03', '2024-02-29'], empty: false }),
    { ...choice('selected empty', [''], [1], { dates: [], empty: true }), expected: () => [1] },
    { ...choice('day and selected empty', ['2026-10-03', ''], [1, 2], { dates: ['2026-10-03'], empty: true }),
      expected: style => style.startsWith('ISO') ? [1, 2] : [1] },
    choice('canonical year boundaries', ['0001-01-01', '0099-12-31', '9999-12-31'], [7, 8, 9],
      { dates: ['0001-01-01', '0099-12-31', '9999-12-31'], empty: false }),
    choice('valid leap century', ['2000-02-29'], [6], { dates: ['2000-02-29'], empty: false }),
    ...['1900-02-29', '2026-02-29', '2026-13-01', '2026-04-31', '0000-01-01'].map(value => choice(`invalid fallback ${value}`, [value], [])),
    choice('five-digit year fallback', ['10000-01-01'], [10]),
    choice('BC fallback', ['0001-01-01 BC'], [11]),
    { ...choice('infinities fallback', ['infinity', '-infinity'], [12, 13]), expected: () => [12, 13] },
    { ...choice('mixed invalid whole-list fallback', ['2026-10-03', '', 'invalid'], [1, 2]),
      expected: style => style.startsWith('ISO') ? [1, 2] : [1] },
    { ...choice('mixed infinity whole-list fallback', ['2026-10-03', '', 'infinity'], [1, 2, 12]),
      expected: style => style.startsWith('ISO') ? [1, 2, 12] : [1, 12] },
    { ...choice('mixed BC whole-list fallback', ['2026-10-03', '', '0001-01-01 BC'], [1, 2, 11]),
      expected: style => style.startsWith('ISO') ? [1, 2, 11] : [1] },
    { ...choice('mixed five-digit whole-list fallback', ['2026-10-03', '', '10000-01-01'], [1, 2, 10]),
      expected: style => style.startsWith('ISO') ? [1, 2, 10] : [1] },
    { ...choice('Unicode outer choice whitespace', ['2026-10-03'], [2], { dates: ['2026-10-03'], empty: false }),
      filter: buildWeldColumnValueFilter(['\u00a02026-10-03\ufeff']) },
    exact('legacy exact', '=2026-10-03', '2026-10-03', [2], { dates: ['2026-10-03'], empty: false }),
    exact('legacy quoted ASCII spaces', " = ' 2026-10-03 ' ", ' 2026-10-03 ', [2], { dates: ['2026-10-03'], empty: false }),
    exact('legacy Unicode inside quotes fallback', "='\u00a02026-10-03\u00a0'", '\u00a02026-10-03\u00a0', []),
    exact('legacy TAB inside quotes fallback', "='\t2026-10-03\t'", '\t2026-10-03\t', []),
    exact('legacy unquoted Unicode JS trim', '=\u00a0\t2026-10-03\u00a0\t', '2026-10-03', [2], { dates: ['2026-10-03'], empty: false }),
    { ...exact('legacy selected empty', "= ''", '', [1], { dates: [], empty: true }), expected: () => [1] },
    { ...exact('legacy ASCII space-only', "='   '", '   ', [1], { dates: [], empty: true }), expected: () => [1] },
    { ...choice('SQL formatted fallback', ['10/03/2026'], [2]), expected: style => style.startsWith('SQL') ? [style.endsWith('MDY') ? 2 : 14] : [] },
    { ...choice('German formatted fallback', ['03.10.2026'], [2]), expected: style => style.startsWith('German') ? [2] : [] },
    { ...choice('Postgres formatted fallback', ['03-10-2026'], [2]), expected: style => style.startsWith('Postgres') ? [style.endsWith('MDY') ? 14 : 2] : [] },
    { name: 'fragment fallback', filter: '2026', old: originalDate('contains', ['2026']), expected: () => [2, 4, 14] },
    { name: 'LIKE wildcard fallback', filter: '%', old: originalDate('contains', ['%']), expected: () => booleanDates.map((_, n) => n + 1) },
  ]
}

export async function checkBooleanOracle(client: Client, checks: object[],
  inspectSql?: (item: BooleanCase, variants: { original: Query; 'previous-native': Query; current: Query }) => void) {
  const dialect = new PgDialect()
  // Fixed diagnostic VALUES, no table writes or candidate-derived fixture.
  const values = booleanDates.map((date, index) => `(${index + 1}, ${date === null ? 'null::date' : `date '${date}'`})`).join(', ')
  for (const style of booleanStyles) {
    await client.query("select set_config('DateStyle',$1,true)", [style])
    for (const item of booleanCases()) {
      const current = dialect.sqlToQuery(buildWeldDateColumnWhere(item.filter.trim()))
      const variants = { original: item.old, 'previous-native': previousNativeDate(item.old, item.native), current }
      // The ordinary regression checks behavior only. The opt-in experiment
      // may additionally require an exact historical SQL shape for its rewrite.
      inspectSql?.(item, variants)
      const ids = item.expected(style)
      const expected = booleanDates.map((_, index) => {
        const value = ids.includes(index + 1)
        return { id: index + 1, value, negated: !value, and_true: value, and_false: false,
          and_null: value ? null : false, or_true: true, or_false: value, or_null: value ? true : null }
      })
      for (const [variant, predicate] of Object.entries(variants)) {
        const query = { sql: `select id, value, not value as negated, value and true as and_true,
          value and false as and_false, value and null::boolean as and_null, value or true as or_true,
          value or false as or_false, value or null::boolean as or_null from (
            select id, (${predicate.sql}) as value from (values ${values}) as "weld_joints"(id,weld_date)
          ) checked order by id`, params: predicate.params }
        const result = await executeDateQuery(client, query)
        expect(result.rows, `${style}/${item.name}/${variant} full boolean oracle`).toEqual(expected)
        checks.push({ style, name: item.name, variant, eligible: Boolean(item.native), ids,
          rows: result.rows.length, booleanDigest: hash(result.rows) })
      }
    }
  }
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const rawDateTypes = { getTypeParser: ((oid: number, format?: 'text' | 'binary') => format === 'binary'
  ? pg.types.getTypeParser(oid, 'binary') : [1082, 1114, 1184].includes(oid)
    ? (value: string) => value : pg.types.getTypeParser(oid, 'text')) as typeof pg.types.getTypeParser }

export async function executeDateQuery(client: Client, query: Query) {
  return client.query({ text: query.sql, values: query.params, types: rawDateTypes })
}
