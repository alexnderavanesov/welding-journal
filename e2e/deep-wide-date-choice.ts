import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, type Page, type TestInfo } from '@playwright/test'
import { and, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { weldJoints } from '../src/db/schema'
import { DEFAULT_OTHER_SETTINGS } from '../src/lib/other-settings'
import { splitReportQuickSearch } from '../src/lib/report-quick-search'
import { buildWeldColumnValueFilter } from '../src/lib/weld-column-choice-filter'
import type { JournalGridRequest, JournalGridResult } from '../src/lib/journal-server-grid'
import { buildReportQueryWhere, getReportOrderBy } from '../src/server/weld-read'
import { WELD_TABLE_SELECT } from '../src/server/weld-server-shared'
import { journalNaturalPageIds } from '../src/server/journal-natural-page'
import { withE2eDatabase } from './database'
import { popupMarker, type PopupFact } from './deep-popup-fixture'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from './rpc'
import { booleanDates, booleanStyles, checkBooleanOracle, executeDateQuery as execute,
  originalDate, previousNativeDate, type NativeDate, type Query } from './weld-date-choice-oracle'

type Capture = { sequence: number; backendPid: number; rpc: string; capturedAt: string; startedAt: string;
  completedAt?: string; rows?: number; queryError?: string; sql: string; parameters: unknown[] }
type Case = { name: string; dates: string[]; count: number }
const settings = { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'manual' as const }
const days = Array.from({ length: 10 }, (_, n) => `2026-10-${String(n + 1).padStart(2, '0')}`)
const cases: Case[] = [
  { name: 'year-ten-desc', dates: days.slice().reverse(), count: 100000 },
  { name: 'found-ten-asc', dates: days, count: 100000 },
  { name: 'single-day', dates: ['2026-10-03'], count: 10000 },
  { name: 'no-date', dates: [], count: 200000 },
]
const roundOrder = [
  ['original', 'previous-native', 'current'],
  ['previous-native', 'current', 'original'],
  ['current', 'original', 'previous-native'],
] as const
const dateColumn = '"weld_joints"."weld_date"'

/** Replace only the complete known C6 date expression with one frozen older
 * expression. Verify every bind before replacement; all other SQL stays the
 * same except bind numbering. No candidate copy is executed as "current". */
function historicalDate(query: Query, old: Query, native: NativeDate, variant: 'original' | 'previous-native', occurrences: 1 | 2): Query {
  const previous = previousNativeDate(old, native)
  const nativeMatch = native.dates.length ? `${dateColumn} = any($${old.params.length + 1}::date[])` : ''
  const guardedMatch = nativeMatch ? `(${dateColumn} is not null and ${nativeMatch})` : ''
  const safeNative = guardedMatch ? native.empty ? `(${guardedMatch} or ${dateColumn} is null)` : guardedMatch : `${dateColumn} is null`
  const stencil = `(${safeNative} and case when split_part(current_setting('DateStyle'), ',', 1) = 'ISO' then true else ${old.sql} end)`
  const replacement = variant === 'original' ? old.sql : previous.sql
  const parameterPositions: number[] = []
  const pattern = stencil.split(/(\$\d+)/).map(part => {
    if (/^\$\d+$/.test(part)) { parameterPositions.push(Number(part.slice(1))); return '\\$(\\d+)' }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('')
  let replaced = 0
  const removed = new Set<number>()
  const text = query.sql.replace(new RegExp(pattern, 'g'), (...args: string[]) => {
    replaced++
    const actualPositions = new Map<number, number>()
    parameterPositions.forEach((position, index) => {
      const actual = Number(args[index + 1])
      assert.deepEqual(query.params[actual - 1], previous.params[position - 1], 'Unexpected date-stencil bind')
      if (actualPositions.has(position)) assert.equal(actualPositions.get(position), actual)
      actualPositions.set(position, actual)
    })
    assert.equal(actualPositions.size, previous.params.length)
    if (variant === 'original' && native.dates.length) removed.add(actualPositions.get(old.params.length + 1)!)
    return replacement.replace(/\$(\d+)/g, (_, value: string) => {
      const actual = actualPositions.get(Number(value))
      assert.ok(actual)
      return `$${actual}`
    })
  })
  assert.equal(replaced, occurrences, 'Unexpected C6 date expression; do not rewrite a different query shape')
  // C6's native array bind precedes text binds. Restore numbering in SQL order
  // for each historical expression; dropping any unrelated bind is forbidden.
  const positions = new Map<number, number>(), params: unknown[] = []
  const historicalSql = text.replace(/\$(\d+)/g, (_, value: string) => {
    const position = Number(value)
    assert(position > 0 && position <= query.params.length && !removed.has(position))
    if (!positions.has(position)) { params.push(query.params[position - 1]); positions.set(position, params.length) }
    return `$${positions.get(position)}`
  })
  assert.equal(removed.size, variant === 'original' && native.dates.length ? occurrences : 0)
  query.params.forEach((_, index) => assert.equal(positions.has(index + 1), !removed.has(index + 1), 'Only removed native-date binds may disappear'))
  return { sql: historicalSql, params }
}

function variantsForCase(query: Query, item: Case, occurrences: 1 | 2) {
  const historical = (variant: 'original' | 'previous-native') => item.dates.length
    ? historicalDate(query, originalDate('values', item.dates), { dates: item.dates, empty: false }, variant, occurrences)
    : { sql: query.sql, params: [...query.params] }
  return { original: historical('original'), 'previous-native': historical('previous-native'), current: query }
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function requestFor(item: Case): JournalGridRequest {
  return { report: 'lnk', columnFilters: { search: popupMarker,
    ...(item.dates.length ? { weldDate: buildWeldColumnValueFilter(item.dates) } : {}) },
  groupBy: [], route: [], start: 0, end: 100, sort: { fieldKey: 'joint', direction: 'asc' } }
}

/** Mirrors only the actual first-block leaf assembly; its complete generated
 * SQL AND parameters must equal the independently captured HTTP SELECT. */
function currentQueries(client: Client, item: Case) {
  const request = requestFor(item)
  const where = and(buildReportQueryWhere('lnk', splitReportQuickSearch(request.columnFilters), settings))!
  const order = getReportOrderBy('lnk', request.sort!, settings)
  const db = drizzle(client)
  const leaf = db.select(WELD_TABLE_SELECT).from(weldJoints)
    .where(sql`${weldJoints.id} in ${journalNaturalPageIds(where, order, 100)}`)
    .orderBy(...order).limit(100).offset(0).toSQL()
  const membership = db.select({ total: sql<number>`count(*)::int`.as('total'),
    ids: sql<number[]>`array_agg(${weldJoints.id} order by ${weldJoints.id})`.as('ids') }).from(weldJoints).where(where).toSQL()
  return { leaf, membership }
}
export async function measureWideDateChoice(page: Page, facts: PopupFact[], info: TestInfo) {
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.AUDIT_SQL_COUNTS).toBe('1')
  expect(process.env.DEEP_WIDE_DATE_CHOICE).toBe('1')
  expect(process.env.DEEP_POPUP_ROWS).toBe('200000')
  expect(facts).toHaveLength(200000)
  const markerFile = process.env.AUDIT_SQL_COUNTS_FILE!.replace(/counts\.json$/, 'wide-date-leaf.json')
  expect(markerFile).not.toBe(process.env.AUDIT_SQL_COUNTS_FILE)
  const ordered = facts.slice().sort((a, b) => a.joint.localeCompare(b.joint))
  const factDigest = hash(ordered)
  const evidence: { phase: string; complete: boolean; failure?: string; environment?: unknown;
    captures: object[]; booleanChecks: object[]; checks: object[]; samples: object[]; plans: object[] } = {
    phase: 'bootstrap', complete: false, captures: [], booleanChecks: [], checks: [], samples: [], plans: [],
  }
  const save = () => writeFile(info.outputPath('wide-date-choice.json'), JSON.stringify({
    version: 'wide-date-production-regression-v3', fixture: { rows: facts.length, factDigest, marker: popupMarker },
    bundle: resolve(process.env.E2E_AUDIT_OUTPUT_DIR ?? '.output'), pairs: 3, roundOrder, cases,
    booleanOracle: { styles: booleanStyles, dates: booleanDates,
      columns: ['value', 'NOT', 'AND TRUE', 'AND FALSE', 'AND NULL', 'OR TRUE', 'OR FALSE', 'OR NULL'] },
    comparison: 'Actual current production date predicate versus frozen original text and C5 native prefilter, on the same schema/data/leaf query; not complete old-versus-new application timing.',
    limits: ['Actual HTTP SELECT and all parameters must exactly equal the current compiled natural-ID union first100 LNK/jointASC query.',
      'HTTP capture/priming and full membership checks are outside SQL timings. No HTTP speed claim: its explicit capture writes a diagnostic marker.',
      'One repeatable-read/read-only SQL snapshot; transaction-local 60s statement_timeout, no planner switches or index changes.',
      'All three variants warmed once, then three rotating rounds. Original/previous-native relative order remains O/P, P/O, O/P; EXPLAIN ANALYZE BUFFERS only after timed rounds.',
      'Historical variants replace only the known complete C6 date expression with independently frozen old text/C5 expressions, checking every bind. Only bind numbering changes elsewhere.',
      'Small independent raw-date VALUES oracle checks full boolean/NOT/AND/OR results in four DateStyle families. Transaction-local DateStyle changes are restored before timed queries.',
      'Full physical leaf JSON including row_version must match; independent fixture IDs/counts and actual HTTP IDs/counts checked.',
      'Dates remain the real popup year DESC versus Select Found ASC lists; marker quick search and all LNK membership predicates remain unchanged.'],
    ...evidence,
  }, null, 2))
  try {
    await save()
    let observed = ''
    page.on('request', request => { if (rpcName(request.url()).startsWith('readJournalGrid_')) observed = request.url() })
    await page.goto('/lnk')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(popupMarker)
    await expect(page.getByText('Найдено: 200000', { exact: true })).toBeVisible({ timeout: 240000 })
    await page.waitForLoadState('networkidle')
    expect(observed).toBeTruthy()
    const endpoint = siblingRpcUrl(observed, 'readJournalGrid_createServerFn_handler')
    await page.goto('about:blank') // stop UI refetches before capturing sequential target RPCs
    let sequence = 0, revision: JournalGridResult['revision'] | undefined
    const captured = new Map<string, Capture>()
    for (const item of cases) {
      evidence.phase = `capture:${item.name}`
      console.log('DEEP_WIDE_DATE_PHASE', evidence.phase)
      await save()
      const request = { ...requestFor(item), ...(revision === undefined ? {} : { revision }) }
      const response = await page.request.post(endpoint, { data: await serializeRpcData(request),
        headers: { origin: new URL(endpoint).origin, 'sec-fetch-site': 'same-origin',
          'content-type': 'application/json', 'x-tsr-serverFn': 'true' }, timeout: 240000 })
      expect(response.ok()).toBe(true)
      const payload = await deserializeRpcResponse(await response.text()) as { result: JournalGridResult; error?: Error }
      if (payload.error) throw payload.error
      const result = payload.result
      const expected = ordered.filter(row => !item.dates.length || item.dates.includes(row.weldDate))
      expect(expected).toHaveLength(item.count)
      expect(result.rowCount).toBe(item.count)
      expect(result.rows.map(row => row.id)).toEqual(expected.slice(0, 100).map(row => row.id))
      if (revision !== undefined) expect(result.revision).toBe(revision)
      revision = result.revision
      const capture = JSON.parse(await readFile(markerFile, 'utf8')) as Capture
      expect(capture.sequence).toBeGreaterThan(sequence)
      expect(capture.rpc).toBe(new URL(endpoint).pathname.split('/_serverFn/')[1])
      expect(capture.queryError).toBeUndefined(); expect(capture.completedAt).toBeTruthy(); expect(capture.rows).toBe(100)
      sequence = capture.sequence; captured.set(item.name, capture)
      evidence.captures.push({ name: item.name, request, capture, sqlHash: hash(capture.sql), parameterHash: hash(capture.parameters) })
      await save()
    }
    await withE2eDatabase(async client => {
      await client.query('begin isolation level repeatable read read only')
      try {
        await client.query("set local statement_timeout='60s'")
        evidence.environment = (await client.query(`select current_database() as database,version(),
          current_setting('DateStyle') as date_style,current_setting('work_mem') as work_mem,
          current_setting('jit') as jit,current_setting('enable_nestloop') as enable_nestloop,
          (select pg_get_indexdef(to_regclass('public.weld_joints_joint_choice_idx'))) as joint_choice_index`)).rows[0]
        expect((evidence.environment as { database: string }).database).toBe('welding_tracker_e2e')
        evidence.phase = 'small-boolean-oracle'
        console.log('DEEP_WIDE_DATE_PHASE', evidence.phase)
        await save()
        await checkBooleanOracle(client, evidence.booleanChecks, (item, variants) => {
          const current = variants.current
          if (!item.native) assert.deepEqual({ sql: current.sql, params: current.params }, item.old, 'Fallback must be byte-identical to the old expression')
          else {
            assert.deepEqual(historicalDate(current, item.old, item.native, 'original', 1), variants.original)
            assert.deepEqual(historicalDate(current, item.old, item.native, 'previous-native', 1), variants['previous-native'])
          }
        })
        await client.query("select set_config('DateStyle',$1,true)", [(evidence.environment as { date_style: string }).date_style])
        await save()
        for (const item of cases) {
          evidence.phase = `sql:${item.name}`
          console.log('DEEP_WIDE_DATE_PHASE', evidence.phase)
          await save()
          const current = currentQueries(client, item), capture = captured.get(item.name)!
          expect(current.leaf.sql, 'Compiled current leaf must be the exact actual HTTP SELECT').toBe(capture.sql)
          expect(current.leaf.params, 'Every actual HTTP bind must match').toEqual(capture.parameters)
          const variants = variantsForCase(current.leaf, item, 2)
          const expected = ordered.filter(row => !item.dates.length || item.dates.includes(row.weldDate))
          const ids = expected.map(row => row.id).sort((a, b) => a - b)
          for (const membership of Object.values(variantsForCase(current.membership, item, 1))) {
            const result = await execute(client, membership)
            expect(result.rows).toEqual([{ total: item.count, ids }])
          }
          let reference: unknown[] | undefined
          const verify = (rows: Array<Record<string, unknown>>) => {
            expect(rows.map(row => row.id)).toEqual(expected.slice(0, 100).map(row => row.id))
            if (reference) expect(rows).toEqual(reference)
            else reference = rows
            const json = JSON.stringify(rows)
            return { rows: rows.length, bytes: Buffer.byteLength(json), digest: hash(rows) }
          }
          for (const query of Object.values(variants)) verify((await execute(client, query)).rows)
          evidence.checks.push({ name: item.name, matching: item.count, membershipDigest: hash(ids),
            leafIds: expected.slice(0, 100).map(row => row.id), fullLeafDigest: hash(reference),
            ...variants, exactHttpQuery: true })
          for (let round = 0; round < roundOrder.length; round++) for (const variant of roundOrder[round]) {
            const started = performance.now(), result = await execute(client, variants[variant])
            const milliseconds = performance.now() - started
            evidence.samples.push({ name: item.name, round, variant, milliseconds, ...verify(result.rows) })
          }
          for (const variant of roundOrder[0]) {
            const query = variants[variant]
            const result = await client.query('explain (analyze,buffers,format json) ' + query.sql, query.params)
            evidence.plans.push({ name: item.name, variant, plan: result.rows[0]['QUERY PLAN'] })
          }
          await save()
        }
      } finally { await client.query('rollback') }
    })
    evidence.complete = true; evidence.phase = 'complete'
  } catch (error) { evidence.failure = String(error); throw error }
  finally { await save() }
}
