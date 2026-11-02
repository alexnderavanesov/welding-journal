import { expect, type TestInfo } from '@playwright/test'
import pg from 'pg'
import { writeFile } from 'node:fs/promises'
import type { DocumentHistoryGridRequest } from '../src/lib/document-history-grid'
import { loadIndexedSystemDocumentHistoryGrid } from '../src/server/system-document-index'
import { normalizeSystemDocumentHistoryGridRequest } from '../src/server/system-documents'
import { assertOriginalSystemDocumentGridFingerprint, buildOriginalSystemDocumentGridQuery } from './deep-system-document-original'
import { withE2eDatabase } from './database'

type Query = { text: string; values: unknown[] }
const defaults: DocumentHistoryGridRequest = { startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] }

/** Uses the existing independent 600k-document fixture, before its deletion
 * probes. Its normal project-filtered reads exercise the measured fallback;
 * these unfiltered reads additionally exercise the actual compact path. */
export async function verifyCompactDocumentCardinality(info: TestInfo) {
  assertOriginalSystemDocumentGridFingerprint()
  const repeats = Number(process.env.AUDIT_DOCUMENT_COMPACT_REPEATS ?? 3)
  expect(Number.isInteger(repeats) && repeats >= 1 && repeats <= 20).toBe(true)
  const measurements: object[] = []
  let activeCase = ''
  try {
    for (const [type, expectedTotal] of [['lnkRequest', 140000], ['lnkConclusion', 260000],
      ['pstoRequest', 20000], ['pstoConclusion', 20000]] as const) {
      const initialRequest = normalizeSystemDocumentHistoryGridRequest({ ...defaults, type, columnFilters: {} })
      const initialQuery = buildOriginalSystemDocumentGridQuery(initialRequest)
      const initial = await withE2eDatabase(db => db.query(initialQuery.text, initialQuery.values))
      expect(initial.rows[0].total).toBe(expectedTotal)
      const ids = initial.rows[0].rows.slice(0, 3).map((row: { documentId: number }) => `system-document:${row.documentId}`)
      expect(ids).toHaveLength(3)
      const cases: Array<[string, Partial<DocumentHistoryGridRequest>]> = [
        ['first', {}], ['next', { startRow: 100, endRow: 200 }],
        ['groups', { rowGroupCols: ['line'] }],
        ['leaf', { rowGroupCols: ['line'], groupKeys: ['["value","L0001"]'] }],
        ['numeric-date-sort', { sortModel: [{ colId: 'rowCount', sort: 'desc' }, { colId: 'date', sort: 'asc' }] }],
        ['selection', { selectionOnly: true, selectedIds: ids, revision: initial.rows[0].revision }],
      ]
      for (const [name, partial] of cases) {
        activeCase = `${type}/${name}`
        const request = normalizeSystemDocumentHistoryGridRequest({ ...defaults, ...partial, type, columnFilters: {} })
        const baseline = buildOriginalSystemDocumentGridQuery(request)
        const queries: Query[] = [], original = pg.Client.prototype.query
        pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
          const text = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string })?.text ?? ''
          const values = Array.isArray(args[1]) ? args[1] : (args[0] as { values?: unknown[] })?.values ?? []
          if (text.includes('"document_history" as not materialized') && text.includes('as "revision"')) queries.push({ text, values })
          return (original as (...values: unknown[]) => unknown).apply(this, args)
        } as typeof original
        try {
          const actual = await loadIndexedSystemDocumentHistoryGrid(request)
          expect(actual.total).toBe(expectedTotal)
          expect(actual.rows.length).toBe(name === 'selection' ? 3 : name === 'leaf' ? Math.min(actual.rowCount, 100) : 100)
          expect(actual.rows.length).toBeGreaterThan(0)
          if (name === 'groups') expect(actual.rowCount).toBe(2000)
        } finally { pg.Client.prototype.query = original }
        expect(queries, activeCase).toHaveLength(1)
        const production = queries[0]
        expect(production.text).not.toMatch(/"filtered_documents" as materialized\s*\(\s*select \* from "document_history"/)
        await withE2eDatabase(async db => {
          const reference = await db.query(baseline.text, baseline.values)
          expect(reference.rows[0].revision).toBe(initial.rows[0].revision)
          for (let round = 0; round < repeats; round++) {
            for (const variant of round % 2 ? ['production', 'baseline'] : ['baseline', 'production']) {
              const query = variant === 'baseline' ? baseline : production
              const started = performance.now(), result = await db.query(query.text, query.values)
              const milliseconds = performance.now() - started
              expect(result.rows, `${activeCase}/${variant}/${round}`).toEqual(reference.rows)
              measurements.push({ type, name, variant, round, milliseconds,
                bytes: Buffer.byteLength(JSON.stringify(result.rows)), total: expectedTotal,
                ...(round === 0 ? { query } : {}) })
            }
          }
        })
        console.log('DOCUMENT_COMPACT_CARDINALITY', JSON.stringify({ type, name, repeats, completeOutputEqual: true }))
        await save()
      }
    }
  } finally { await save() }

  function save() {
    return writeFile(info.outputPath('document-compact-cardinality.json'), JSON.stringify({
      fixture: { joints: 200000, documents: 600000, relations: 2880000, positions: 3280000 },
      repeats, activeCase, measurements,
      limits: 'Warm local SQL. Actual production loader query versus fingerprinted original; complete raw JSON, revision and byte equality. No replacement for the separate browser, mutation and filtered-path checks in the parent profile.',
    }, null, 2))
  }
}
