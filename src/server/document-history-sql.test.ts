import { PgDialect } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { buildWeldColumnValueFilter } from '@/lib/weld-table-filtering'
import {
  buildDocumentHistoryFilterOptionsSqlQuery,
  buildDocumentHistorySqlQuery,
  normalizeSqlDocumentHistoryFilterOptions,
  normalizeSqlDocumentHistoryResult,
} from '@/server/document-history-sql'

describe('document history SQL', () => {
  it('pages in SQL and calculates each option set without its own active filter', () => {
    const query = buildDocumentHistorySqlQuery({
      baseQuery: sql`
        select
          1 as "id",
          array['П1']::text[] as "filter_project",
          array['Ш1']::text[] as "filter_subtitle"
      `,
      columnFilters: {
        project: buildWeldColumnValueFilter(['П1']),
        subtitle: buildWeldColumnValueFilter(['Ш1']),
      },
      filterKeys: ['project', 'subtitle'],
      limit: 25,
      orderBy: sql`"id" desc`,
    })
    const compiled = new PgDialect().sqlToQuery(query)

    expect(compiled.sql).toContain('with "document_history" as not materialized')
    expect(compiled.sql).toContain('"filtered_documents" as materialized')
    expect(compiled.sql).toContain('limit $')
    expect(compiled.params.filter((value) => value === 'п1')).toHaveLength(2)
    expect(compiled.params.filter((value) => value === 'ш1')).toHaveLength(2)
    expect(compiled.params).toContain(25)
  })

  it('normalizes page rows, totals and naturally sorted dependent options', () => {
    const result = normalizeSqlDocumentHistoryResult(
      {
        documents: [{ id: 7, title: 'Документ' }],
        total: '12',
        filterOptions: {
          rowCount: [
            { value: '10', count: 1 },
            { value: '', count: 2 },
            { value: '2', count: 3 },
          ],
        },
      },
      ['rowCount', 'project'],
      (record) => ({ id: Number(record.id), title: String(record.title) }),
    )

    expect(result).toEqual({
      documents: [{ id: 7, title: 'Документ' }],
      total: 12,
      filterOptions: {
        rowCount: [
          { value: '', label: '(пусто)', count: 2 },
          { value: '2', label: '2', count: 3 },
          { value: '10', label: '10', count: 1 },
        ],
        project: [],
      },
    })
  })

  it('can page and count an indexed history without materializing every wide row', () => {
    const query = buildDocumentHistorySqlQuery({
      baseQuery: sql`
        select
          1 as "id",
          array['Линия 1']::text[] as "filter_line"
      `,
      columnFilters: {},
      filterKeys: ['line'],
      optionKeys: ['line'],
      materializeFilteredDocuments: false,
      limit: 100,
      orderBy: sql`"id" desc`,
    })
    const compiled = new PgDialect().sqlToQuery(query)

    expect(compiled.sql).toContain('as not materialized')
    expect(compiled.sql).not.toContain('"filtered_documents"')
    expect(compiled.sql).toContain('select count(*)::integer')
    expect(compiled.sql).toContain('jsonb_build_object')
  })

  it('loads one bounded option set with dependent filters and server-side search', () => {
    const query = buildDocumentHistoryFilterOptionsSqlQuery({
      baseQuery: sql`
        select
          1 as "id",
          array['П1']::text[] as "filter_project",
          array['Линия 17']::text[] as "filter_line"
      `,
      columnFilters: {
        project: buildWeldColumnValueFilter(['П1']),
        line: buildWeldColumnValueFilter(['Линия 17']),
      },
      filterKeys: ['project', 'line'],
      key: 'line',
      search: '17',
      limit: 2,
    })
    const compiled = new PgDialect().sqlToQuery(query)

    expect(compiled.sql).toContain('with "document_history" as not materialized')
    expect(compiled.sql).toContain('cross join lateral')
    expect(compiled.params.filter((value) => value === 'п1')).toHaveLength(1)
    expect(compiled.params).not.toContain('линия 17')
    expect(compiled.params).toContain('17')
    expect(compiled.params).toContain(3)
  })

  it('bounds remote options and reports that more matches exist', () => {
    expect(normalizeSqlDocumentHistoryFilterOptions([
      { value: 'L-1', count: '3' },
      { value: 'L-2', count: 2 },
      { value: 'L-3', count: 1 },
    ], 2)).toEqual({
      options: [
        { value: 'L-1', label: 'L-1', count: 3 },
        { value: 'L-2', label: 'L-2', count: 2 },
      ],
      hasMore: true,
    })
  })
})
