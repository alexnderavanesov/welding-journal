import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import type { DocumentHistoryGridRequest } from '@/lib/document-history-grid'
import { buildWeldColumnValueFilter } from '@/lib/weld-table-filtering'
import {
  buildDocumentHistoryGridSql, documentHistoryTextSort, normalizeDocumentHistoryGridRequest,
  normalizeDocumentHistoryGridResult, withDocumentHistoryGridSearch,
} from './document-history-grid'

const keys = ['title', 'line', 'rowCount', 'date']
const base: DocumentHistoryGridRequest = { startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] }
const normalize = (request: Partial<DocumentHistoryGridRequest> = {}) => normalizeDocumentHistoryGridRequest({ ...base, ...request }, keys, 'system')
const compile = (request: DocumentHistoryGridRequest, columnFilters = {}) => new PgDialect().sqlToQuery(buildDocumentHistoryGridSql({
  baseQuery: sql`select * from document_test_summaries`, columnFilters, filterKeys: keys, request, idKind: 'system',
  sortExpressions: { title: documentHistoryTextSort('title'), line: documentHistoryTextSort('line'), rowCount: sql`"rowCount"`, date: sql`nullif("date", '')::date` },
  defaultOrder: sql`"date" desc, "documentId" desc`,
}))

describe('document registry grid request', () => {
  it('bounds blocks independently of the registry size and rejects unsupported columns/directions', () => {
    expect(normalize({ startRow: 200_000, endRow: 200_500 })).toMatchObject({ startRow: 200_000, endRow: 200_500 })
    for (const request of [
      { startRow: -1 }, { endRow: 0 }, { endRow: 501 }, { startRow: 1.5 },
      { rowGroupCols: ['line', 'line'] }, { rowGroupCols: ['sourceMetadata'] },
      { sortModel: [{ colId: 'line', sort: 'drop table' as 'asc' }] },
      { sortModel: [{ colId: 'rowCount;drop table', sort: 'asc' as const }] },
    ]) expect(() => normalize(request)).toThrow()
  })

  it('accepts only opaque canonical group keys and valid depths', () => {
    expect(normalize({ rowGroupCols: ['line'], groupKeys: ['[ "value", "Несколько линий" ]'] }).groupKeys).toEqual(['["value","Несколько линий"]'])
    for (const groupKeys of [['Линия'], ['["all"]'], ['["value", ""]'], ['["empty"]', '["multiple"]']]) {
      expect(() => normalize({ rowGroupCols: ['line'], groupKeys })).toThrow()
    }
  })

  it('preserves exact ID semantics and rejects malformed or out-of-range IDs', () => {
    expect(normalize({ selectedIds: ['system-document:2', 'system-document:1', 'system-document:2'] }).selectedIds).toEqual(['system-document:2', 'system-document:1'])
    for (const id of [2, '2', 'system-document:0', 'system-document:2 OR TRUE', 'system-document:2147483648']) {
      expect(() => normalize({ selectedIds: [id] })).toThrow()
    }
    expect(normalizeDocumentHistoryGridRequest({ ...base, selectedIds: [2, 1, 2] }, keys, 'generated').selectedIds).toEqual([2, 1])
  })

  it('requires an explicit bounded selection for hydration, with no implicit select-all', () => {
    expect(() => normalize({ selectionOnly: true })).toThrow()
    expect(() => normalize({ selectionOnly: true, selectedIds: Array.from({ length: 10_001 }, (_, index) => `system-document:${index + 1}`) })).toThrow()
    expect(normalize({ selectionOnly: true, selectedIds: [] })).toMatchObject({ selectionOnly: true, selectedIds: [] })
  })
})

describe('document registry grid SQL', () => {
  it('sorts typed values before applying a bounded block and uses a stable ID tie-breaker', () => {
    const query = compile(normalize({ startRow: 100, endRow: 200, sortModel: [{ colId: 'rowCount', sort: 'desc' }, { colId: 'date', sort: 'asc' }] }))
    expect(query.sql).toContain('"rowCount" desc nulls last, nullif("date", \'\')::date asc nulls last, "documentId" desc')
    expect(query.sql).toMatch(/limit \$\d+ offset \$\d+/)
    expect(query.params.slice(-2)).toEqual([100, 100])
    expect(query.sql).toContain('(select count(*)::integer from "filtered_documents") as "total"')
  })

  it('groups summaries once, keeps multi-values in one bucket and counts all documents before block pagination', () => {
    const query = compile(normalize({ rowGroupCols: ['line'] }))
    expect(query.sql).toContain('select distinct btrim("group_value")')
    expect(query.sql).toContain("jsonb_build_array('multiple'::text)")
    expect(query.sql).toContain('count(*)::integer as "childCount"')
    expect(query.sql).toContain('from "scoped_documents" group by')
    expect(query.sql).not.toContain('cross join lateral')
    expect(query.sql.indexOf('"level_rows"')).toBeLessThan(query.sql.indexOf('"block_rows"'))
  })

  it('keeps filtering/search and matching selection outside the expanded-group route', () => {
    const query = compile(normalize({
      rowGroupCols: ['line'], groupKeys: ['["value","Л-2"]'], search: ' Документ ',
      selectedIds: ['system-document:8', 'system-document:5'],
    }), { title: buildWeldColumnValueFilter(['Точный']) })
    expect(query.params).toContain('точный')
    expect(query.params).toContain('документ')
    expect(query.params).toContain('["value","Л-2"]')
    expect(query.params).toContainEqual([8, 5])
    expect(query.sql).toMatch(/jsonb_agg\("documentId" order by "documentId"\) from "filtered_documents"\s+where "documentId" = any/)
    expect(query.sql).toContain('"scoped_documents" as not materialized')
  })

  it('hydrates only selected documents, ignores a stale group route and remains one batched query', () => {
    const request = normalize({ rowGroupCols: ['line'], groupKeys: ['["value","old group"]'], startRow: 100, endRow: 200, selectionOnly: true, selectedIds: ['system-document:2', 'system-document:4'] })
    const query = compile(request)
    expect(query.params).not.toContain('["value","old group"]')
    expect(query.params).toContain(10_000)
    expect(query.params).toContain(0)
    expect(query.sql).toContain('select * from "filtered_documents" where "documentId" = any(')
    expect(query.sql).not.toContain('group by')
    const many = compile(normalize({ selectedIds: Array.from({ length: 5000 }, (_, index) => `system-document:${index + 1}`) }))
    const few = compile(normalize({ selectedIds: ['system-document:1'] }))
    expect(many.sql).toBe(few.sql)
    expect(many.params).toHaveLength(few.params.length)
  })

  it('applies literal global search to facet metadata without changing column filter semantics', () => {
    const text = buildWeldColumnValueFilter(['П1'])
    const query = new PgDialect().sqlToQuery(withDocumentHistoryGridSearch(sql`select * from summaries`, text, ['title', 'line']))
    expect(query.params).toEqual([text.toLocaleLowerCase('ru-RU'), text.toLocaleLowerCase('ru-RU')])
    expect(query.sql).toContain('position(')
    expect(query.sql).not.toContain('= any')
  })
})

describe('document registry grid result', () => {
  it('separates real values from empty/multiple group labels and returns full child counts', () => {
    const result = normalizeDocumentHistoryGridResult({ rows: [
      { groupKey: ['multiple'], childCount: '2000' }, { groupKey: ['value', 'Несколько линий'], childCount: 4 }, { groupKey: ['empty'], childCount: 1 },
    ], rowCount: 3, total: 2005 }, normalize({ rowGroupCols: ['line'] }), 'system', row => row)
    expect(result.rows).toMatchObject([
      { __group: true, groupKey: '["multiple"]', groupLabel: 'Несколько линий', childCount: 2000, line: 'Несколько линий' },
      { __group: true, groupKey: '["value","Несколько линий"]', groupLabel: 'Несколько линий' },
      { __group: true, groupKey: '["empty"]', groupLabel: '(пусто)' },
    ])
    expect(new Set(result.rows.map(row => row.id)).size).toBe(3)
    expect(result.total).toBe(2005)
  })

  it('prunes IDs only against all-query matches, preserves original order and distinguishes omitted selection', () => {
    const raw = { rows: [{ documentId: 2 }], rowCount: 1, total: 500, matchingSelectedIds: [2, 4] }
    const result = normalizeDocumentHistoryGridResult(raw, normalize({ selectedIds: ['system-document:4', 'system-document:3', 'system-document:2'] }), 'system', row => ({ id: row.documentId }))
    expect(result).toEqual({ rows: [{ id: 2 }], rowCount: 1, total: 500, matchingSelectedIds: ['system-document:4', 'system-document:2'] })
    expect(normalizeDocumentHistoryGridResult(raw, normalize(), 'system', row => row)).not.toHaveProperty('matchingSelectedIds')
  })

  it('scopes group identities to the grouped columns as well as their values', () => {
    const raw = { rows: [{ groupKey: ['value', 'Same label'], childCount: 1 }], rowCount: 1, total: 1 }
    const line = normalizeDocumentHistoryGridResult(raw, normalize({ rowGroupCols: ['line'] }), 'system', row => row)
    const title = normalizeDocumentHistoryGridResult(raw, normalize({ rowGroupCols: ['title'] }), 'system', row => row)
    expect(line.rows[0].id).not.toBe(title.rows[0].id)
  })
})
