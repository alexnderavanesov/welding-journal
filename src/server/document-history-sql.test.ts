import { PgDialect } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { buildWeldColumnValueFilter } from '@/lib/weld-table-filtering'
import {
  buildDocumentHistorySqlQuery,
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

    expect(compiled.sql).toContain('with "document_history" as materialized')
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
})
