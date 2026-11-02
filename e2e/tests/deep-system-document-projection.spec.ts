import { expect, test } from '@playwright/test'
import pg from 'pg'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { writeFile } from 'node:fs/promises'
import { withE2eDatabase } from '../database'
import { withLineProgramFixture } from '../line-program-fixtures'
import { loadIndexedSystemDocumentHistoryGrid, loadSystemDocumentSummaries, syncSystemDocumentsForWeldChangesInTransaction, SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS } from '../../src/server/system-document-index'
import { normalizeSystemDocumentHistoryGridRequest } from '../../src/server/system-documents'
import { touchDocumentMembershipParents } from '../../src/server/document-version'
import type { DocumentHistoryGridRequest } from '../../src/lib/document-history-grid'
import { weldJoints } from '../../src/db/schema'
import { SYSTEM_DOCUMENT_TYPES, type SystemDocumentType } from '../../src/lib/system-document-types'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-column-choice-filter'
import { assertOriginalSystemDocumentGridFingerprint, buildOriginalSystemDocumentGridQuery } from '../deep-system-document-original'

const enabled = process.env.DEEP_SYSTEM_DOCUMENT_PROJECTION === '1'
test.skip(!enabled, 'Opt-in read-only query experiment on owned local fixture')
test.use({ trace: 'off', video: 'off' })
const sizes = process.env.DEEP_SYSTEM_DOCUMENT_COUNT ? [Number(process.env.DEEP_SYSTEM_DOCUMENT_COUNT)] : [2000, 20_000]
const prefix = 'E2E slim system documents '
const comparisonRepeats = Number(process.env.DEEP_DOCUMENT_PROJECTION_REPEATS ?? 3)
const comparisonVariants = (process.env.DEEP_DOCUMENT_PROJECTION_VARIANTS ?? 'baseline,production').split(',')
const requestedCases = process.env.DEEP_DOCUMENT_PROJECTION_CASES?.split(',')
const defaults: DocumentHistoryGridRequest = { startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] }
type Query = { text: string; values: unknown[] }
type Case = { name: string; type?: SystemDocumentType; documentId?: number; filters?: Record<string, string>; request?: Partial<DocumentHistoryGridRequest> }
const normalized = (item: Case) => normalizeSystemDocumentHistoryGridRequest({
  ...defaults, ...item.request, type: item.type ?? 'lnkRequest', documentId: item.documentId, columnFilters: item.filters ?? {},
})
const originalQuery = (item: Case) => buildOriginalSystemDocumentGridQuery(normalized(item))

test.beforeAll(() => { assertOriginalSystemDocumentGridFingerprint() })

/** Diagnostic-only, strict-shape rewrite of the *actual* current SQL. Keeping
 * original WHERE/parameters, revision, counts and full card projection allows
 * whole-output equality before any production helper is changed. */
function narrowQuery(query: Query, request: Partial<DocumentHistoryGridRequest> = {}, beforeMetadata = false) {
  if (request.rowGroupCols?.length || request.sortModel?.length || request.cells || request.countRoutes) return { ...query, narrowed: false }
  const filtered = /("filtered_documents" as materialized\s*\(\s*)select \* from "document_history"/
  const block = /"block_rows" as materialized\s*\(\s*select \* from "level_rows"[\s\S]*?\n\s{4}\)/
  if (!filtered.test(query.text) || !block.test(query.text)) throw new Error('Current SQL shape changed; do not broaden experimental rewrite')
  let hydration = `select "full_document".* from "document_history" as "full_document"
      inner join "block_ids" on "block_ids"."documentId" = "full_document"."documentId"`
  if (beforeMetadata) {
    const base = query.text.match(/with "document_history" as not materialized \(([\s\S]*?)\n  \),\n    "filtered_documents"/)
    const source = /(from "generated_documents"\s+where [\s\S]*?)(\n      \) as "document_record")/
    if (!base || !source.test(base[1])) throw new Error('Current source barrier changed; refuse experimental rewrite')
    // Hydrate the selected IDs before the text-to-jsonb OFFSET 0 barrier.
    // Joining outside it still parses metadata for every document, even when
    // only a small page survived the original project/line filter.
    hydration = base[1].replace(source, '$1 and "generated_documents"."id" in (select "documentId" from "block_ids")$2')
  }
  const text = query.text.replace(filtered, '$1select "documentId", "documentVersion", "date", "title" from "document_history"')
    .replace(block, match => `${match.replace('"block_rows"', '"block_ids"')},
    "block_rows" as materialized (
      ${hydration}
    )`)
  return { text, values: query.values, narrowed: true }
}

/** Broaden the diagnostic to group/custom-sort layouts without changing their
 * expressions. Filter/search still see the original aliases. Only the CTE's
 * retained columns shrink; full registry cards are hydrated for leaf IDs. */
function compactQuery(query: Query, request: Partial<DocumentHistoryGridRequest> = {}) {
  if (request.cells?.summary) return { ...query, narrowed: false }
  const keys = [...new Set([...(request.rowGroupCols ?? []), ...(request.sortModel ?? []).map(item => item.colId)])]
  if (keys.some(key => !SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS.includes(key as typeof SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS[number]))) {
    throw new Error('Unexpected projection field; refuse diagnostic rewrite')
  }
  const columns = ['documentId', 'documentVersion', 'date', 'title', ...(keys.includes('rowCount') ? ['rowCount'] : []),
    ...keys.map(key => `filter_${key}`)].map(key => `"${key}"`).join(', ')
  const filtered = /("filtered_documents" as materialized\s*\(\s*)select \* from "document_history"/
  if (!filtered.test(query.text)) throw new Error('Original projection missing; capture before changing production source')
  let text = query.text.replace(filtered, `$1select ${columns} from "document_history"`)
  const grouped = !request.selectionOnly && !request.idsOnly && Boolean(request.rowGroupCols?.[request.groupKeys?.length ?? 0])
  if (!grouped && !request.idsOnly) {
    const block = /"block_rows" as materialized\s*\(\s*select \* from "level_rows"[\s\S]*?\n\s{4}\)/
    const base = query.text.match(/with "document_history" as not materialized \(([\s\S]*?)\n  \),\n    "filtered_documents"/)
    const source = /(from "generated_documents"\s+where [\s\S]*?)(\n      \) as "document_record")/
    if (!block.test(text) || !base || !source.test(base[1])) throw new Error('Original hydration barrier changed; refuse diagnostic rewrite')
    const hydration = base[1].replace(source, '$1 and "generated_documents"."id" in (select "documentId" from "block_ids")$2')
    text = text.replace(block, match => `${match.replace('"block_rows"', '"block_ids"')},
    "block_rows" as materialized (
      ${hydration}
    )`)
  }
  return { text, values: query.values, narrowed: true }
}

async function capture(item: Case) {
  const queries: Query[] = [], original = pg.Client.prototype.query
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const text = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string })?.text ?? ''
    const values = Array.isArray(args[1]) ? args[1] : (args[0] as { values?: unknown[] })?.values ?? []
    if (text.includes('"document_history" as not materialized') && text.includes('as "revision"')) queries.push({ text, values })
    return (original as (...values: unknown[]) => unknown).apply(this, args)
  } as typeof original
  try {
    await loadIndexedSystemDocumentHistoryGrid(normalized(item))
  } finally { pg.Client.prototype.query = original }
  expect(queries, item.name).toHaveLength(1)
  return { ...queries[0], narrowed: !/"filtered_documents" as materialized\s*\(\s*select \* from "document_history"/.test(queries[0].text) }
}

for (const total of sizes) test(`system document narrow projection equals complete current query: ${total}`, async ({}, info) => {
  test.setTimeout(1_800_000)
  expect([2000, 20_000, 200_000]).toContain(total)
  expect(Number.isInteger(comparisonRepeats) && comparisonRepeats >= 1 && comparisonRepeats <= 100).toBe(true)
  expect(comparisonVariants.length > 0 && comparisonVariants.every(value => ['baseline', 'candidate', 'guarded', 'compact', 'production'].includes(value))).toBe(true)
  const documents: number[] = [], welds: number[] = [], measurements: object[] = []
  const cases: Case[] = [
    { name: 'first' }, { name: 'next', request: { startRow: 100, endRow: 200 } },
    { name: 'last', request: { startRow: total - 100, endRow: total } },
    { name: 'title', filters: { title: '000123' } }, { name: 'project', filters: { project: 'Проект-007' } },
    { name: 'line', filters: { line: 'Линия-0012' } }, { name: 'quick-search-wide', request: { search: 'ТВМТ' } },
    { name: 'quick-search-narrow-line', request: { search: 'Линия-0012' } },
    { name: 'quick-search-narrow-title', request: { search: '000123' } },
    { name: 'quick-search-missing', request: { search: 'отсутствующая-метка' } },
    { name: 'custom-sort-fallback', request: { sortModel: [{ colId: 'project', sort: 'asc' }, { colId: 'title', sort: 'desc' }] } },
    { name: 'group-fallback', request: { rowGroupCols: ['project'] } },
    { name: 'group-nested-root', request: { rowGroupCols: ['project', 'line'], sortModel: [{ colId: 'project', sort: 'desc' }] } },
    { name: 'group-nested-child', request: { rowGroupCols: ['project', 'line'], groupKeys: ['["multiple"]'], sortModel: [{ colId: 'line', sort: 'desc' }] } },
    { name: 'group-nested-leaf', request: { rowGroupCols: ['project', 'line'], groupKeys: ['["multiple"]', '["multiple"]'], sortModel: [{ colId: 'rowCount', sort: 'asc' }, { colId: 'date', sort: 'desc' }] } },
    { name: 'numeric-date-sort', request: { sortModel: [{ colId: 'rowCount', sort: 'desc' }, { colId: 'date', sort: 'asc' }] } },
  ]
  if (requestedCases) expect(requestedCases.every(name => cases.some(item => item.name === name))).toBe(true)
  await loadSystemDocumentSummaries('lnkRequest')
  try {
    await withLineProgramFixture(async client => {
      expect((await client.query('select count(*)::integer as total from generated_documents')).rows[0].total).toBe(0)
      const inserted = await client.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date)
        select 'Проект-'||lpad((n%40)::text,3,'0'),'Код-'||(n%10),'Линия-'||lpad(n::text,4,'0'),$1||n,
          date '2026-10-01'+n%20 from generate_series(1,100) n returning id`, [prefix])
      welds.push(...inserted.rows.map(row => row.id))
      await client.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date)
        select unnest($1::integer[]),2,'fixture-cycle','2026-10-01'`, [welds])
      await client.query(`create temporary table deep_system_positions on commit drop as
        select n,ordinality as p,w.id as weld_id,c.id as cycle_id,w.project_title,w.subtitle_code,w.line,w.weld_date
        from generate_series(1,$1::integer) n
        cross join lateral generate_series(1,case when n%10=0 then 100 when n%2=0 then 10 else 1 end) with ordinality as pos(position,ordinality)
        join weld_joints w on w.id=($2::integer[])[((n+pos.position-2)%100)+1]
        join psto_repeat_cycles c on c.weld_joint_id=w.id and c.sequence=2`, [total, welds])
      const created = await client.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata)
        select 'system:tvmtRequest',$1||lpad(n::text,6,'0'),'slim.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          date '2026-10-01'+n%20,date '2026-10-01'+n%20,count(*)::integer,
          jsonb_build_object('sourceKind','pstoCycle','cycleSequences',jsonb_build_array(2),'methodCodes',jsonb_build_array('ТВМТ'),
            'positionCount',count(*),'projects',jsonb_agg(distinct project_title),'subtitleCodes',jsonb_agg(distinct subtitle_code),
            'lines',jsonb_agg(distinct line),'periodFrom',min(weld_date),'periodTo',max(weld_date),
            'sourcePositions',jsonb_agg(jsonb_build_object('kind','pstoCycle','weldJointId',weld_id,'relationId',cycle_id,'sequence',2,'methodCode','ТВМТ') order by p))::text
        from deep_system_positions group by n returning id`, [prefix])
      documents.push(...created.rows.map(row => row.id))
      await client.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
        select d.id,p.weld_id from deep_system_positions p join generated_documents d on d.title=$1||lpad(p.n::text,6,'0')`, [prefix])
      for (const table of ['generated_documents', 'generated_document_weld_joints', 'weld_joints']) await client.query(`analyze ${table}`)
    })
    // Capturing monkey-patches pg.Client.query globally; never overlap captures.
    const saved: Array<{ item: Case; baseline: Query; candidate: Query & { narrowed: boolean }; guarded: Query & { narrowed: boolean }; compact: Query & { narrowed: boolean }; production: Query & { narrowed: boolean } }> = []
    for (const item of cases.filter(item => !requestedCases || requestedCases.includes(item.name))) {
      const baseline = originalQuery(item), production = await capture(item)
      saved.push({ item, baseline, production, candidate: narrowQuery(baseline, item.request), guarded: narrowQuery(baseline, item.request, true), compact: compactQuery(baseline, item.request) })
    }
    await withE2eDatabase(async client => {
      for (const { item, baseline, candidate, guarded, compact, production } of saved) {
        const before = await client.query(baseline.text, baseline.values), after = await client.query(candidate.text, candidate.values)
        expect(after.rows, `${item.name}/complete-output`).toEqual(before.rows)
        expect((await client.query(guarded.text, guarded.values)).rows, `${item.name}/guarded-complete-output`).toEqual(before.rows)
        expect((await client.query(compact.text, compact.values)).rows, `${item.name}/compact-complete-output`).toEqual(before.rows)
        expect((await client.query(production.text, production.values)).rows, `${item.name}/production-complete-output`).toEqual(before.rows)
        if (item.name === 'first') expect(before.rows[0].total).toBe(total)
        expect(candidate.narrowed).toBe(!item.request?.rowGroupCols?.length && !item.request?.sortModel?.length && !item.request?.cells && !item.request?.countRoutes)
        const order = Array.from({ length: comparisonRepeats }, (_, round) => round % 2 ? [...comparisonVariants].reverse() : comparisonVariants).flat()
        for (const [iteration, variant] of order.entries()) {
          const query = variant === 'baseline' ? baseline : variant === 'production' ? production : variant === 'guarded' ? guarded : variant === 'compact' ? compact : candidate
          const started = performance.now(), result = await client.query(query.text, query.values)
          const milliseconds = performance.now() - started
          expect(result.rows, `${item.name}/${variant}/${iteration}`).toEqual(before.rows)
          const plan = iteration < comparisonVariants.length ? (await client.query('explain (analyze,buffers,format json) ' + query.text, query.values)).rows[0]['QUERY PLAN'] : undefined
          measurements.push({ name: item.name, variant, iteration, narrowed: variant === 'baseline' ? false : variant === 'production' ? production.narrowed : variant === 'compact' ? compact.narrowed : candidate.narrowed, milliseconds,
            bytes: Buffer.byteLength(JSON.stringify(result.rows)), ...(plan ? { query, plan } : {}) })
        }
      }
    })
    const first = saved.find(({ item }) => item.name === 'first') ?? await (async () => {
      const item = { name: 'mutation-scope' }, baseline = originalQuery(item), production = await capture(item)
      return { baseline, production, candidate: narrowQuery(baseline), guarded: narrowQuery(baseline, {}, true), compact: compactQuery(baseline) }
    })()
    const compareCurrent = async () => withE2eDatabase(async client => {
      const baseline = await client.query(first.baseline.text, first.baseline.values)
      const candidate = await client.query(first.candidate.text, first.candidate.values)
      expect(candidate.rows).toEqual(baseline.rows)
      expect((await client.query(first.guarded.text, first.guarded.values)).rows).toEqual(baseline.rows)
      expect((await client.query(first.compact.text, first.compact.values)).rows).toEqual(baseline.rows)
      expect((await client.query(first.production.text, first.production.values)).rows).toEqual(baseline.rows)
      return String(baseline.rows[0].revision)
    })
    const initialRevision = await compareCurrent()
    const target = await withE2eDatabase(async client => (await client.query('select id from generated_documents where title=$1', [prefix + '000001'])).rows[0].id as number)
    // Same card payload, additional relation: the existing parent touch is
    // essential even when the compact system metadata itself does not change.
    await withLineProgramFixture(async client => {
      await touchDocumentMembershipParents(drizzle(client) as never, [target])
      await client.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [target, welds[1]])
    })
    const membershipRevision = await compareCurrent()
    expect(membershipRevision).not.toBe(initialRevision)
    // Refresh sourced metadata through the real existing fact-change helper.
    // This work and its writes stay entirely outside read measurements.
    await withLineProgramFixture(async client => {
      const db = drizzle(client)
      const [previous] = await db.select().from(weldJoints).where(eq(weldJoints.id, welds[0]))
      const [changed] = await db.update(weldJoints).set({ line: 'Линия-факт-изменилась', updatedAt: new Date() }).where(eq(weldJoints.id, welds[0])).returning()
      await syncSystemDocumentsForWeldChangesInTransaction(db as never, [changed], new Map([[previous.id, previous]]))
    })
    const factRevision = await compareCurrent()
    expect(factRevision).not.toBe(membershipRevision)
    await writeFile(info.outputPath(`deep-system-document-projection-${total}.json`), JSON.stringify({ total, welds: welds.length,
      positionsPerDocument: [1, 10, 100], comparisonRepeats, comparisonVariants, measurements,
      mutations: { membershipChangedRevision: initialRevision !== membershipRevision, factChangedRevision: membershipRevision !== factRevision, completeOutputEqual: true },
      limits: ['Original query reconstruction is checked against the pre-change SQL and parameter fingerprint.',
        'production is captured from the actual loader; candidate/guarded/compact remain diagnostic transformations.',
        'candidate/guarded are flat-default experiments; compact additionally covers groups and custom sorts.',
        'Two references to the original NOT MATERIALIZED CTE can cause extra scans; complete plans retained.',
        'Warm local SQL; full RPC and the separate 600k-document profile remain necessary.'] }, null, 2))
  } finally {
    if (documents.length || welds.length) await withLineProgramFixture(async client => {
      if (documents.length) await client.query('delete from generated_documents where id=any($1::integer[])', [documents])
      if (welds.length) await client.query('delete from weld_joints where id=any($1::integer[])', [welds])
      for (const table of ['generated_documents', 'generated_document_weld_joints', 'weld_joints']) await client.query(`analyze ${table}`)
    })
  }
})

test('compact projection preserves registry edge cases, typed groups and every selection mode', async ({}, info) => {
  test.setTimeout(600_000)
  const inserted: Array<{ id: number; type: SystemDocumentType; rowCount: number; date: string | null }> = []
  const checks: object[] = [], revisions: object[] = []
  let activeCase = ''
  const dates = [null, '2026-02-01', '2025-12-30', null, '2026-10-01', '2026-01-02', '2026-05-01', '2026-05-01']
  const counts = [0, 2, 10, 100, 2, 10, 10, 10]
  const metadata = [
    {},
    { projects: [' P ', 'P', null, ''], lines: ['L'], methodCodes: ['РК'] },
    { projects: ['P', 'Q'], lines: ['L', 'M'], methodCodes: ['РК', 'ТВМТ'], sourceKind: 'beforeHeatTreatment' },
    { projects: ['P', 'p'], lines: [''], methodCodes: ['РК'], sourceKind: 'pstoCycle', cycleSequences: [10, 2] },
    { projects: [], lines: [null], methodCodes: ['ТВМТ'], sourceKind: 'pstoRepeat',
      sourcePositions: [{ sequence: 2 }, { sequence: 10 }, { sequence: 2 }] },
    { projects: 'legacy non-array', lines: [], sourceKind: 'pstoCycle', cycleSequences: [] },
    { projects: [''], lines: ['L'], methodCodes: [], subtitleCodes: [' S ', 'S'] },
    { projects: ['P'], lines: ['L'], methodCodes: ['ТВМТ'] },
  ]
  // These are read-shape fixtures, including legacy metadata shapes. They do
  // not assert that every synthetic combination is a creatable workflow.
  for (const type of SYSTEM_DOCUMENT_TYPES) await loadSystemDocumentSummaries(type)
  const compare = async (item: Case) => {
    activeCase = item.name
    const baseline = originalQuery(item), production = await capture(item), compact = compactQuery(baseline, item.request)
    return withE2eDatabase(async client => {
      const before = (await client.query(baseline.text, baseline.values)).rows
      const after = (await client.query(compact.text, compact.values)).rows
      expect(after, item.name).toEqual(before)
      expect((await client.query(production.text, production.values)).rows, `${item.name}/production`).toEqual(before)
      checks.push({ name: item.name, compact: compact.narrowed, production: production.narrowed, rows: before[0].rows.length, rowCount: before[0].rowCount,
        total: before[0].total, revision: before[0].revision })
      return { value: before[0], baseline, compact }
    })
  }
  try {
    await withLineProgramFixture(async client => {
      expect((await client.query('select count(*)::integer as total from generated_documents')).rows[0].total).toBe(0)
      for (const type of SYSTEM_DOCUMENT_TYPES) for (let index = 0; index < metadata.length; index++) {
        const storageType = type === 'lnkRequest' ? index === 7 ? 'system:tvmtRequest' : 'system:lnkRequest'
          : type === 'lnkConclusion' ? index === 7 ? 'system:tvmtConclusion' : 'system:lnkConclusionRk' : `system:${type}`
        const title = index === 0 ? '' : index >= 6 ? ' Same title ' : `${prefix}edge-${index}`
        const specialists = index % 2 ? { first: { name: ' Первый специалист ' }, second: { name: 'Второй' } } : null
        const result = await client.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,row_count,source_metadata,specialists)
          values($1,$2,'edge.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',$3,$4,$5,$6::jsonb) returning id`,
        [storageType, title, dates[index], counts[index], JSON.stringify(metadata[index]), JSON.stringify(specialists)])
        inserted.push({ id: result.rows[0].id, type, rowCount: counts[index], date: dates[index] })
      }
    })
    for (const type of SYSTEM_DOCUMENT_TYPES) {
      const own = inserted.filter(item => item.type === type), other = inserted.find(item => item.type !== type)!
      const ids = own.map(item => `system-document:${item.id}`)
      const missing = `system-document:${Math.max(...inserted.map(item => item.id)) + 1000}`
      const selectedIds = [ids[7], ids[1], `system-document:${other.id}`, missing, ids[7]]
      const cases: Case[] = [
        { name: `${type}/flat` },
        { name: `${type}/page`, request: { startRow: 2, endRow: 5 } },
        { name: `${type}/beyond-end`, request: { startRow: 100, endRow: 200 } },
        { name: `${type}/document-id`, documentId: own[1].id },
        { name: `${type}/fragment`, filters: { project: 'p' } },
        { name: `${type}/blank-project-filter`, filters: { project: buildWeldColumnValueFilter(['']) } },
        { name: `${type}/blank-line-filter`, filters: { line: buildWeldColumnValueFilter(['']) } },
        { name: `${type}/narrow-search`, request: { search: 'Первый' } },
        { name: `${type}/search-miss`, request: { search: 'нет-такого-значения' } },
        { name: `${type}/nested-root`, request: { rowGroupCols: ['project', 'line'], selectedIds } },
        { name: `${type}/nested-empty`, request: { rowGroupCols: ['project', 'line'], groupKeys: ['["empty"]'], selectedIds } },
        { name: `${type}/nested-multiple`, request: { rowGroupCols: ['project', 'line'], groupKeys: ['["multiple"]'], selectedIds } },
        { name: `${type}/nested-leaf`, request: { rowGroupCols: ['project', 'line'], groupKeys: ['["value","P"]', '["value","L"]'], sortModel: [{ colId: 'date', sort: 'desc' }], selectedIds } },
        { name: `${type}/absent-route`, request: { rowGroupCols: ['project', 'line'], groupKeys: ['["value","Absent"]'], selectedIds } },
        { name: `${type}/group-page`, request: { rowGroupCols: ['project'], startRow: 1, endRow: 2 } },
        { name: `${type}/selection-ignores-view`, filters: { title: 'no matches' }, request: { selectionOnly: true, selectedIds,
          search: 'also no matches', rowGroupCols: ['project', 'line'], groupKeys: ['["value","Absent"]'], startRow: 100, endRow: 200 } },
        { name: `${type}/empty-selection`, request: { selectionOnly: true, selectedIds: [] } },
        { name: `${type}/all-ids-ignore-page`, request: { idsOnly: true, startRow: 100, endRow: 200 } },
        { name: `${type}/route-ids`, request: { idsOnly: true, rowGroupCols: ['project', 'line'], groupKeys: ['["multiple"]'], startRow: 100, endRow: 200 } },
        { name: `${type}/count-routes`, request: { rowGroupCols: ['project', 'line'], selectedIds,
          countRoutes: [[], ['["multiple"]'], ['["empty"]'], ['["value","P"]'], ['["value","P"]', '["value","L"]'], ['["value","Absent"]']] } },
        { name: `${type}/copy-cells`, request: { cells: { columns: ['title', 'date', 'line', 'stage', 'rowCount', 'specialistFirst'] }, sortModel: [{ colId: 'rowCount', sort: 'desc' }] } },
        { name: `${type}/summary-original`, request: { startRow: 1, endRow: 5, cells: { columns: ['title', 'rowCount', 'date'], summary: true } } },
        { name: `${type}/group-summary-original`, request: { rowGroupCols: ['project'], cells: { columns: ['title', 'rowCount'], summary: true } } },
      ]
      for (const key of SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS) {
        cases.push({ name: `${type}/group-${key}`, request: { rowGroupCols: [key], selectedIds } })
        for (const sort of ['asc', 'desc'] as const) cases.push({ name: `${type}/sort-${key}-${sort}`, request: { sortModel: [{ colId: key, sort }, { colId: key === 'title' ? 'date' : 'title', sort: 'desc' }] } })
      }
      const outputs = new Map<string, Awaited<ReturnType<typeof compare>>>()
      for (const item of cases) outputs.set(item.name, await compare({ ...item, type }))
      // Independent expectations, beyond equality with the original builder.
      expect(outputs.get(`${type}/flat`)!.value.total).toBe(8)
      expect(outputs.get(`${type}/page`)!.value.rows).toHaveLength(3)
      expect(outputs.get(`${type}/beyond-end`)!.value.rows).toEqual([])
      expect(outputs.get(`${type}/blank-project-filter`)!.value.total).toBe(5)
      expect(outputs.get(`${type}/blank-line-filter`)!.value.total).toBe(3)
      const groups = outputs.get(`${type}/group-project`)!.value.rows as Array<{ groupKey: unknown; childCount: number }>
      expect(new Map(groups.map(row => [JSON.stringify(row.groupKey), row.childCount]))).toEqual(new Map([
        ['["empty"]', 4], ['["value","P"]', 2], ['["multiple"]', 2],
      ]))
      expect(outputs.get(`${type}/all-ids-ignore-page`)!.value.ids).toEqual(own.map(item => item.id).sort((a, b) => a - b))
      const selected = outputs.get(`${type}/selection-ignores-view`)!.value
      expect(selected.total).toBe(8); expect(selected.rowCount).toBe(2)
      expect((selected.rows as Array<{ documentId: number }>).map(row => row.documentId).sort((a, b) => a - b)).toEqual([own[1].id, own[7].id])
      const routeCounts = outputs.get(`${type}/count-routes`)!.value.counts
      expect(routeCounts['[]']).toBe(2)
      expect(Object.entries(routeCounts).find(([key]) => JSON.stringify(JSON.parse(key)) === '[["value","P"],["value","L"]]')?.[1]).toBe(2)
      const numeric = await compare({ type, name: `${type}/numeric-independent`, request: { sortModel: [{ colId: 'rowCount', sort: 'asc' }] } })
      expect((numeric.value.rows as Array<{ documentId: number }>).map(row => row.documentId)).toEqual([...own].sort((a, b) => a.rowCount - b.rowCount || b.id - a.id).map(item => item.id))
      const dated = await compare({ type, name: `${type}/date-independent`, request: { sortModel: [{ colId: 'date', sort: 'desc' }] } })
      expect((dated.value.rows as Array<{ documentId: number }>).map(row => row.documentId)).toEqual([...own].sort((a, b) =>
        a.date === b.date ? b.id - a.id : a.date === null ? 1 : b.date === null ? -1 : a.date < b.date ? 1 : -1).map(item => item.id))
      const unfilteredRevisions = [`${type}/flat`, `${type}/page`, `${type}/nested-root`, `${type}/nested-leaf`, `${type}/selection-ignores-view`]
        .map(name => outputs.get(name)!.value.revision)
      expect(new Set(unfilteredRevisions).size).toBe(1)
      let previous = String(outputs.get(`${type}/flat`)!.value.revision)
      for (const [name, assignment, value] of [
        ['title', 'title=$2', 'Changed title'], ['date', 'period_from=$2::date', '2026-12-31'],
        ['specialists', 'specialists=$2::jsonb', JSON.stringify({ first: { name: 'Изменённый специалист' } })],
        ['metadata', 'source_metadata=$2', JSON.stringify({ projects: ['Changed project'], lines: ['Changed line'], sourceKind: 'pstoCycle', cycleSequences: [3] })],
      ]) {
        await withLineProgramFixture(client => client.query(`update generated_documents set ${assignment} where id=$1`, [own[0].id, value]))
        const result = await compare({ type, name: `${type}/changed-${name}` })
        expect(result.value.revision).not.toBe(previous)
        await expect(loadIndexedSystemDocumentHistoryGrid(normalizeSystemDocumentHistoryGridRequest({ ...defaults, type, revision: previous }))).rejects.toThrow('Данные реестра изменились')
        revisions.push({ type, field: name, changed: true, staleRejected: true })
        previous = String(result.value.revision)
      }
    }
  } finally {
    try {
      await writeFile(info.outputPath('deep-system-document-projection-edges.json'), JSON.stringify({ documents: inserted.length, activeCase, checks, revisions,
        limits: ['Synthetic SQL read-shape fixtures, not a creation/business-rule acceptance test.', 'Original query reconstruction is fingerprinted against the pre-change capture; all comparisons use the same local database state.'] }, null, 2))
    } finally {
      if (inserted.length) await withLineProgramFixture(client => client.query('delete from generated_documents where id=any($1::integer[])', [inserted.map(item => item.id)]))
    }
  }
})
