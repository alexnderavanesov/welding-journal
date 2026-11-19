import { expect, type TestInfo } from '@playwright/test'
import pg from 'pg'
import { PgDialect } from 'drizzle-orm/pg-core'
import { writeFile } from 'node:fs/promises'
import type { DocumentHistoryGridRequest } from '../src/lib/document-history-grid'
import { buildWeldColumnValueFilter } from '../src/lib/weld-table-filtering'
import { buildIndexedSystemDocumentHistoryGridSql, loadIndexedSystemDocumentHistoryGrid, loadIndexedSystemDocumentHistoryFilterOptions } from '../src/server/system-document-index'
import { normalizeSystemDocumentHistoryGridRequest, normalizeSystemDocumentHistoryFilterOptionsRequest } from '../src/server/system-documents'
import { buildOriginalSystemDocumentGridQuery, assertOriginalSystemDocumentGridFingerprint } from './deep-system-document-original'
import { withE2eDatabase } from './database'

type Query = { text: string; values: unknown[] }
const defaults: DocumentHistoryGridRequest = { startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] }
const project = 'E2E independent document cardinality'

/** Additional phase of the existing 200k-joint / 600k-document fixture. No
 * separate seed, server, or persistent cache. Run before its deletion probes. */
export async function verifyDocumentCompositionCardinality(info: TestInfo) {
  assertOriginalSystemDocumentGridFingerprint()
  const repeats = Number(process.env.AUDIT_DOCUMENT_COMPOSITION_REPEATS ?? 3)
  expect(Number.isInteger(repeats) && repeats >= 1 && repeats <= 10).toBe(true)
  const measurements: object[] = []
  const plans: object[] = []
  let activeCase = ''
  const temporaryIds: number[] = []
  const request = (overrides: Partial<DocumentHistoryGridRequest> & { columnFilters?: Record<string, string>; documentId?: number } = {}) =>
    normalizeSystemDocumentHistoryGridRequest({ ...defaults, type: 'lnkRequest', columnFilters: {}, ...overrides })

  async function capture<T>(run: () => Promise<T>) {
    const calls: Query[] = [], original = pg.Client.prototype.query
    pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
      const input = args[0] as string | { text?: string; values?: unknown[] }
      calls.push({ text: typeof input === 'string' ? input : input?.text ?? '',
        values: Array.isArray(args[1]) ? args[1] : typeof input === 'object' ? input?.values ?? [] : [] })
      if (calls.at(-1)!.text.includes('"document_history" as not materialized')) {
        // Diagnostic setup only, excluded from the application's SQL count.
        // These indexed loaders already run inside their own transaction.
        return (async () => {
          await (original as (...values: unknown[]) => unknown).call(this, "set local statement_timeout='120s'")
          return (original as (...values: unknown[]) => unknown).apply(this, args)
        })()
      }
      return (original as (...values: unknown[]) => unknown).apply(this, args)
    } as typeof original
    const started = performance.now()
    try {
      const result = await run()
      expect(calls.length, activeCase + ' SQL count').toBeLessThanOrEqual(5)
      const queries = calls.filter(call => call.text.includes('"document_history" as not materialized'))
      expect(queries, activeCase + ' data queries').toHaveLength(1)
      measurements.push({ name: activeCase, phase: 'loader', milliseconds: performance.now() - started,
        statements: calls.length, diagnosticTimeoutStatements: 1, bytes: Buffer.byteLength(JSON.stringify(result)) })
      return { result, query: queries[0] }
    } finally { pg.Client.prototype.query = original }
  }

  // A new visible column and its journal revision salt deliberately change raw
  // output. Compare every other field, count, identity, order and selection.
  const existingOutput = (rows: unknown[]) => JSON.parse(JSON.stringify(rows, (key, value) =>
    ['jointComposition', 'filter_jointComposition', 'revision'].includes(key) ? undefined : value))

  async function measure(current: Query, baseline?: Query) {
    await withE2eDatabase(async db => {
      await db.query("set statement_timeout='120s'")
      if (baseline) {
        const before = await db.query(baseline.text, baseline.values)
        const after = await db.query(current.text, current.values)
        expect(existingOutput(after.rows), activeCase + ' unchanged output').toEqual(existingOutput(before.rows))
      }
      for (let round = 0; round < repeats; round++) {
        for (const variant of baseline ? round % 2 ? ['current', 'baseline'] : ['baseline', 'current'] : ['current']) {
          const query = variant === 'baseline' ? baseline! : current
          const start = performance.now(), result = await db.query(query.text, query.values)
          measurements.push({ name: activeCase, phase: 'SQL', variant, round, milliseconds: performance.now() - start,
            bytes: Buffer.byteLength(JSON.stringify(result.rows)) })
        }
      }
      if (process.env.AUDIT_DOCUMENT_EXPLAIN === '1') {
        const explained = await db.query('explain (analyze, buffers, format json) ' + current.text, current.values)
        plans.push({ name: activeCase, variant: 'current', query: current, plan: explained.rows })
        if (baseline) {
          const previous = await db.query('explain (analyze, buffers, format json) ' + baseline.text, baseline.values)
          plans.push({ name: activeCase, variant: 'baseline', query: baseline, plan: previous.rows })
        }
      }
    })
    console.log('DOCUMENT_COMPOSITION_CARDINALITY', JSON.stringify({ name: activeCase, repeats, comparedWithBaseline: Boolean(baseline) }))
    await save()
  }

  async function verifyMembership(rows: unknown[]) {
    const documents = rows as Array<{ id: string; jointComposition?: string }>
    if (!documents.length) return
    const ids = documents.map(row => Number(row.id.slice('system-document:'.length)))
    const expected = await withE2eDatabase(async db => (await db.query<{ document_id: number; names: Array<string | null> }>(
      `select membership.document_id, array_agg(joint.joint order by joint.id) names
       from generated_document_weld_joints membership join weld_joints joint on joint.id=membership.weld_joint_id
       where membership.document_id=any($1::int[]) group by membership.document_id`, [ids])).rows)
    const byId = new Map(expected.map(row => [row.document_id, row.names.map(name => (name ?? '').trim()).filter(Boolean).join(' ')]))
    documents.forEach((row, index) => expect(row.jointComposition, row.id).toBe(byId.get(ids[index]) ?? ''))
  }

  try {
    const stableCases: Array<[string, Parameters<typeof request>[0], number]> = [
      ['first', {}, 140000], ['next', { startRow: 100, endRow: 200 }, 140000],
      ['project-filter', { columnFilters: { project: buildWeldColumnValueFilter([project]) } }, 140000],
      ['global-title', { search: 'NK-100000' }, 1],
      ['global-no-match', { search: 'COMPOSITION-NONEXISTENT-20261119' }, 0],
    ]
    for (const [name, overrides, total] of stableCases) {
      activeCase = name
      const data = request(overrides), actual = await capture(() => loadIndexedSystemDocumentHistoryGrid(data))
      expect(actual.result.total).toBe(total)
      await verifyMembership(actual.result.rows)
      await measure(actual.query, buildOriginalSystemDocumentGridQuery(data, true))
    }
    const compositionCases: Array<[string, Parameters<typeof request>[0], number]> = [
      ['composition-token-rare', { search: 'F199999' }, 3],
      ['composition-token-wide', { search: 'F' }, 140000],
      ['composition-search', { search: 'F199999 F200000' }, 3],
      ['composition-filter', { columnFilters: { jointComposition: buildWeldColumnValueFilter(['F199999 F200000']) } }, 1],
      ['composition-sort', { sortModel: [{ colId: 'jointComposition', sort: 'desc' as const }] }, 140000],
      ['composition-group-leaf', { rowGroupCols: ['jointComposition'], groupKeys: ['["value","F1 F2"]'] }, 140000],
    ]
    for (const [name, overrides, total] of compositionCases) {
      activeCase = name
      const data = request(overrides)
      if (name.startsWith('composition-token-')) {
        const compiled = new PgDialect().sqlToQuery(buildIndexedSystemDocumentHistoryGridSql(data))
        const query = { text: compiled.sql, values: compiled.params }
        const estimated = await withE2eDatabase(db => db.query('explain (format json) ' + query.text, query.values))
        plans.push({ name, variant: 'current', estimatedBeforeExecution: true, query, plan: estimated.rows })
        await save()
      }
      const actual = await capture(() => loadIndexedSystemDocumentHistoryGrid(data))
      expect(actual.result.total).toBe(total)
      expect(actual.result.rowCount).toBe(name === 'composition-group-leaf' ? 3 : total)
      await verifyMembership(actual.result.rows)
      if (name === 'composition-sort') {
        // Independent oracle: rebuild complete member arrays directly from
        // relations, without application projection/filter/sort helpers.
        const ordered = await withE2eDatabase(async db => (await db.query<{ id: number }>(`
          select document.id from generated_documents document
          join generated_document_weld_joints membership on membership.document_id=document.id
          join weld_joints joint on joint.id=membership.weld_joint_id
          where document.type in ('system:lnkRequest','system:tvmtRequest') group by document.id
          order by lower(array_to_string(array_agg(joint.joint order by joint.id),' ')) desc, document.id desc limit 100`)).rows)
        expect(actual.result.rows.map(row => row.id)).toEqual(ordered.map(row => `system-document:${row.id}`))
      }
      await measure(actual.query)
    }
    activeCase = 'composition-facet'
    const facet = await capture(() => loadIndexedSystemDocumentHistoryFilterOptions(normalizeSystemDocumentHistoryFilterOptionsRequest({
      type: 'lnkRequest', fieldKey: 'jointComposition', search: 'F199999 F200000', columnFilters: {},
    })))
    expect(facet.result.options).toHaveLength(3)
    expect(facet.result.options.every(option => option.value.includes('F199999 F200000') && option.count === 1)).toBe(true)
    await measure(facet.query)

    // Add a large and empty legacy document temporarily, then remove exactly
    // these IDs before the parent fixture's existing counters/deletion probes.
    await withE2eDatabase(async db => {
      const added = await db.query<{ id: number; row_count: number }>(`insert into generated_documents(type,title,file_name,mime_type,row_count,source_metadata)
        values ('system:lnkRequest','COMPOSITION-LARGE-AUDIT','large.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',10000,'{"methodCodes":["ВИК"]}'),
        ('system:lnkRequest','COMPOSITION-EMPTY-AUDIT','empty.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',0,'{"methodCodes":["ВИК"]}') returning id,row_count`)
      const longId = added.rows.find(row => row.row_count === 10000)!.id
      const emptyId = added.rows.find(row => row.row_count === 0)!.id
      temporaryIds.push(longId, emptyId)
      await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
        select $1,id from weld_joints where project_title=$2 and isometry::int<=10000`, [longId, project])
    })
    for (const [offset, name, expectedCount] of [[0, 'long-composition', 10000], [1, 'empty-composition', 0]] as const) {
      activeCase = name
      const actual = await capture(() => loadIndexedSystemDocumentHistoryGrid(request({ documentId: temporaryIds[offset] })))
      expect(actual.result.total).toBe(1)
      expect(actual.result.rows[0]).toMatchObject({ rowCount: expectedCount })
      await verifyMembership(actual.result.rows)
      const text = (actual.result.rows[0] as { jointComposition: string }).jointComposition
      expect(text ? text.split(' ').length : 0).toBe(expectedCount)
      if (expectedCount) expect(text.length).toBeGreaterThan(32767)
      await measure(actual.query)
    }
  } finally {
    if (temporaryIds.length) await withE2eDatabase(db => db.query('delete from generated_documents where id=any($1::int[])', [temporaryIds]))
    await save()
  }

  function save() {
    return writeFile(info.outputPath('document-composition-cardinality.json'), JSON.stringify({
      fixture: { joints: 200000, documents: 600000, relations: 2880000, positions: 3280000 },
      repeats, activeCase, measurements, plans,
      limits: 'Warm local SQL with alternating pre-composition compact baseline/current order; current loader statement count. Equality intentionally excludes the new composition field and journal revision salt. Large/empty documents are temporary additions. No claim about production latency.',
    }, null, 2))
  }
}
