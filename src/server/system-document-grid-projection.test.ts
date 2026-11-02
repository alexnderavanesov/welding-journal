import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import type { DocumentHistoryGridRequest } from '@/lib/document-history-grid'
import { buildWeldColumnValueFilter } from '@/lib/weld-column-choice-filter'
import { buildDocumentHistoryGridSql, normalizeDocumentHistoryGridRequest } from './document-history-grid'
import { buildIndexedSystemDocumentHistoryGridSql, SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS } from './system-document-index'
import { assertOriginalSystemDocumentGridFingerprint, buildOriginalSystemDocumentGridQuery } from '../../e2e/deep-system-document-original'

vi.mock('@/db', () => ({ requireDb: () => { throw new Error('Unexpected real DB access') } }))

const defaults: DocumentHistoryGridRequest = { startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] }
const request = (value: Partial<DocumentHistoryGridRequest> = {}, columnFilters: Record<string, string> = {}, documentId?: number) => ({
  ...normalizeDocumentHistoryGridRequest({ ...defaults, ...value }, SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS, 'system'),
  type: 'lnkRequest' as const, columnFilters, documentId,
})
const compile = (value = request()) => new PgDialect().sqlToQuery(buildIndexedSystemDocumentHistoryGridSql(value))
const normalizeSql = (text: string) => text.replace(/\s+/g, ' ').trim()
const projectedColumns = (text: string) => text.match(/"filtered_documents" as materialized\s*\(\s*select ([\s\S]*?) from "document_history"/)![1]
const page = (query: ReturnType<typeof compile>) => {
  const parameters = query.sql.match(/limit \$(\d+) offset \$(\d+)/)!
  return parameters.slice(1).map(index => query.params[Number(index) - 1])
}

describe('compact indexed document grid projection', () => {
  it('keeps the reconstructed original SQL and parameters equal to the captured pre-change fingerprint', () => {
    expect(() => assertOriginalSystemDocumentGridFingerprint()).not.toThrow()
  })

  it('retains the full-query revision and counts while restricting hydration before metadata parsing', () => {
    const query = compile(request({ startRow: 100, endRow: 200 }))
    expect(projectedColumns(query.sql)).toBe('"documentId", "documentVersion", "date", "title"')
    expect(page(query)).toEqual([100, 100])
    const hydration = query.sql.slice(query.sql.indexOf('"block_rows" as materialized'))
    const restriction = hydration.indexOf('"generated_documents"."id" in (select "documentId" from "block_ids")')
    expect(restriction).toBeGreaterThan(hydration.indexOf('from "generated_documents"'))
    expect(restriction).toBeLessThan(hydration.indexOf(') as "document_record"'))
    expect(restriction).toBeLessThan(hydration.indexOf('offset 0'))
    expect(hydration).toContain('"document_source"."specialists", "document_source"."specialistsRevision"')
    expect(hydration).toContain('jsonb_build_object(')
    expect(hydration).toContain('as "metadata"')
    expect(query.sql).toContain('order by "date" desc, "title" desc, "documentId" desc')
    expect(query.sql).toContain('(select count(*)::integer from "filtered_documents") as "total"')
    expect(query.sql).toContain('string_agg(md5("documentId"::text || \':\' || "documentVersion"), \'\' order by "documentId")')
    expect(query.sql).not.toContain('to_jsonb("filtered_documents")')
    expect(query.params.filter(value => value === 'system:lnkRequest')).toHaveLength(2)
    expect(query.params.filter(value => value === 'system:tvmtRequest')).toHaveLength(2)
  })

  it('keeps documentId and storage-type restrictions on both source and hydration reads', () => {
    const query = compile(request({}, {}, 41))
    const conditions = [...query.sql.matchAll(/"generated_documents"\."id" = \$(\d+)/g)]
    expect(conditions).toHaveLength(2)
    expect(conditions.map(match => query.params[Number(match[1]) - 1])).toEqual([41, 41])
  })

  it.each(['method', 'stage', 'project', 'subtitle', 'line'])('preserves the exact original query for active %s column filters', key => {
    for (const filter of ['Фрагмент', buildWeldColumnValueFilter(['']), buildWeldColumnValueFilter(['A', 'B'])]) {
      const value = request({ search: 'also search', rowGroupCols: ['project'], sortModel: [{ colId: 'date', sort: 'desc' }] }, { [key]: filter })
      const current = compile(value), original = buildOriginalSystemDocumentGridQuery(value)
      expect(normalizeSql(current.sql)).toBe(normalizeSql(original.text))
      expect(current.params).toEqual(original.values)
      expect(projectedColumns(current.sql)).toBe('*')
    }
  })

  it('keeps compact projection for empty metadata filters and direct fields', () => {
    const query = compile(request({ search: '  ' }, { project: '  ', title: 'Фрагмент', specialistFirst: 'Имя' }))
    expect(projectedColumns(query.sql)).not.toBe('*')
    expect(query.params).toContain('фрагмент')
    expect(query.params).toContain('имя')
    expect(query.sql).toContain('"filter_line"')
    expect(query.sql).toContain('"block_ids" as materialized')
  })

  it.each(['ТВМТ', 'Линия-0012', '000123', 'отсутствующая-метка'])('preserves the original global search query for %s', search => {
    for (const partial of [{}, { rowGroupCols: ['line'] }, { sortModel: [{ colId: 'date', sort: 'asc' as const }] }]) {
      const value = request({ ...partial, search })
      const current = compile(value), original = buildOriginalSystemDocumentGridQuery(value)
      expect(normalizeSql(current.sql)).toBe(normalizeSql(original.text))
      expect(current.params).toEqual(original.values)
    }
  })

  it('retains every group/count-route field without hydrating group payloads', () => {
    const query = compile(request({ rowGroupCols: ['project', 'line'], sortModel: [{ colId: 'rowCount', sort: 'desc' }],
      selectedIds: ['system-document:8'], countRoutes: [[], ['["empty"]'], ['["value","A"]', '["multiple"]']] }))
    expect(projectedColumns(query.sql)).toBe('"documentId", "documentVersion", "date", "title", "rowCount", "filter_project", "filter_line", "filter_rowCount"')
    expect(query.sql).not.toContain('"block_ids"')
    expect(query.sql).toContain('count(*)::integer as "childCount"')
    expect(query.sql).toContain('select distinct btrim("group_value")')
    expect(query.sql).toContain("jsonb_build_array('multiple'::text)")
    expect(query.sql).toContain('from "filtered_documents" where "documentId" = any(')
    expect(query.sql).toContain('null::jsonb as "matchingSelectedIds"')
  })

  it('preserves numeric/date sorting and the ID tie-breaker for hydrated leaves', () => {
    const query = compile(request({ rowGroupCols: ['project', 'line'], groupKeys: ['["multiple"]', '["empty"]'],
      sortModel: [{ colId: 'rowCount', sort: 'asc' }, { colId: 'date', sort: 'desc' }] }))
    expect(projectedColumns(query.sql)).toContain('"rowCount", "filter_project", "filter_line", "filter_rowCount", "filter_date"')
    expect(query.sql).toContain('"rowCount" asc nulls last, nullif("date", \'\')::date desc nulls last, "documentId" desc')
    expect(query.params).toContain('["multiple"]')
    expect(query.params).toContain('["empty"]')
    expect(query.sql).toContain('"block_ids" as materialized')
  })

  it.each([{ selectedIds: [] }, { selectedIds: ['system-document:2', 'system-document:4'] }])('restores explicit selection $selectedIds independently of obsolete filters, route and page', ({ selectedIds }) => {
    const query = compile(request({ selectionOnly: true, selectedIds, search: 'excluded search', startRow: 100, endRow: 200,
      rowGroupCols: ['line'], groupKeys: ['["value","obsolete"]'] }, { line: 'excluded filter' }))
    expect(projectedColumns(query.sql)).not.toBe('*')
    expect(query.params).not.toContain('excluded search')
    expect(query.params).not.toContain('excluded filter')
    expect(query.params).not.toContain('["value","obsolete"]')
    expect(query.params).toContainEqual(selectedIds.map(id => Number(id.slice('system-document:'.length))))
    expect(page(query)).toEqual([10_000, 0])
    expect(query.sql).toContain('"block_ids" as materialized')
    expect(query.sql).not.toContain(' as "childCount"')
  })

  it('returns IDs from the complete route without invoking card hydration or applying the page to IDs', () => {
    const query = compile(request({ idsOnly: true, rowGroupCols: ['project'], groupKeys: ['["empty"]'], startRow: 100, endRow: 200 }))
    expect(query.sql).not.toContain('"block_ids"')
    expect(page(query)).toEqual([0, 100])
    expect(query.sql).toContain('jsonb_agg("documentId" order by "documentId"), \'[]\'::jsonb) from "scoped_documents"')
    expect(query.params).toContain('["empty"]')
  })

  it('hydrates original registry cards for cell copy and keeps complete cell summaries on the original path', () => {
    const copy = compile(request({ cells: { columns: ['stage', 'line', 'rowCount'] } }))
    expect(copy.sql).toContain('"block_ids" as materialized')
    expect(copy.sql).toContain('as "filter_stage"')
    for (const rowGroupCols of [[], ['project']]) {
      const value = request({ rowGroupCols, cells: { columns: ['title', 'rowCount'], summary: true } })
      const current = compile(value), original = buildOriginalSystemDocumentGridQuery(value)
      expect(normalizeSql(current.sql)).toBe(normalizeSql(original.text))
      expect(current.params).toEqual(original.values)
      expect(current.sql).not.toContain('"block_ids"')
    }
  })

  it.each(['generated', 'system'] as const)('never compacts a %s history without a sufficient revision token', idKind => {
    const hydrate = vi.fn(() => sql`select * from should_not_hydrate`)
    const query = new PgDialect().sqlToQuery(buildDocumentHistoryGridSql({ baseQuery: sql`select * from full_rows`,
      request: defaults, columnFilters: {}, filterKeys: [], idKind, sortExpressions: {}, defaultOrder: sql`1`,
      ...(idKind === 'generated' ? { revisionValue: sql`"version"` } : {}),
      compact: { columns: ['documentId'], hydrate } }))
    expect(projectedColumns(query.sql)).toBe('*')
    expect(hydrate).not.toHaveBeenCalled()
  })
})
