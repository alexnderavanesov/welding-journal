import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { normalizePstoExceptionTableRequest } from '@/lib/psto-exception-table'
import { buildWeldColumnValueFilter } from '@/lib/weld-column-choice-filter'
import { readPstoExceptionTable, readPstoExceptionFilterOptions } from './psto-exception-table'

describe('PSTO exception table', () => {
  it('bounds pages and rejects unknown filter fields', () => {
    expect(normalizePstoExceptionTableRequest({ page: -2, pageSize: 200 })).toMatchObject({ page: 0, pageSize: 50 })
    expect(normalizePstoExceptionTableRequest({ pageSize: 100 })).toMatchObject({ pageSize: 100 })
    expect(() => normalizePstoExceptionTableRequest({ filters: { injected: 'x' } })).toThrow()
  })
  it.each([true, false])('filters the complete source and counts/pages in one snapshot (candidates=%s)', async candidates => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ rows: [], totalCount: 0, page: 0 }] })
    const request = normalizePstoExceptionTableRequest({ page: 7, filters: { linePsto: buildWeldColumnValueFilter(['Не назначена']), line: "x' OR 1=1 --" } })
    await readPstoExceptionTable({ execute } as never, request, candidates)
    expect(execute).toHaveBeenCalledOnce()
    const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
    expect(compiled.sql.indexOf('where')).toBeLessThan(compiled.sql.indexOf('limit'))
    expect(compiled.sql).not.toContain("x' OR 1=1 --")
    expect(compiled.params).toContain("x' OR 1=1 --")
    expect(compiled.params).toContainEqual(['Не назначена'])
    expect(compiled.sql).toContain('count(*)::int')
    expect(compiled.sql).toContain('least(')
  })
  it('facets ignore their own selection, retain other filters and load bounded pages', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: Array.from({ length: 151 }, (_, id) => ({ value: `J${id}`, count: 1 })) })
    const result = await readPstoExceptionFilterOptions({ execute } as never, normalizePstoExceptionTableRequest({ filters: { joint: 'OLD', line: 'LINE' } }), true, 'joint', 'NEW', 150)
    const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
    expect(compiled.params).not.toContain('OLD')
    expect(compiled.params).toContain('LINE')
    expect(compiled.params).toContain('NEW')
    expect(result.options).toHaveLength(150)
    expect(result.next).toBe(300)
    expect(execute).toHaveBeenCalledOnce()
  })
})
