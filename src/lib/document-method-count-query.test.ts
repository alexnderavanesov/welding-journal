import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { documentMethodCountQuery } from './document-method-count-query'
import { GENERATED_DOCUMENT_HISTORY_QUERY_KEY } from './weld-query-utils'
import { buildWeldColumnValueFilter } from './weld-column-choice-filter'

const scope = {
  viewId: 'system:lnkConclusion:lnk', type: 'lnkConclusion' as const,
  columnFilters: { project: 'PROJECT', stage: 'LNK', method: buildWeldColumnValueFilter(['РК']) },
  gridSearch: 'CONCLUSION',
}

describe('document method count query', () => {
  it('reuses counts across method tabs but reloads after the existing document invalidation', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const read = vi.fn(async () => ({ options: [{ value: 'РК', count: 3 }, { value: 'УЗК', count: 5 }] }))
    const fetch = (input: typeof scope) => {
      const query = documentMethodCountQuery(input)
      return client.fetchQuery({ queryKey: query.queryKey, queryFn: () => read(), staleTime: 30_000 })
    }
    try {
      const initial = await fetch(scope)
      const ultrasonic = { ...scope, columnFilters: { ...scope.columnFilters, method: buildWeldColumnValueFilter(['УЗК']) } }
      expect(await fetch(ultrasonic)).toEqual(initial)
      expect(await fetch(scope)).toEqual(initial)
      expect(read).toHaveBeenCalledTimes(1)
      await client.invalidateQueries({ queryKey: GENERATED_DOCUMENT_HISTORY_QUERY_KEY })
      await fetch(ultrasonic)
      expect(read).toHaveBeenCalledTimes(2)
    } finally { client.clear() }
  })

  it('keeps every other request scope in the key and does not mutate selected filters', () => {
    const original = structuredClone(scope.columnFilters)
    const base = documentMethodCountQuery(scope)
    expect(base.request).toEqual({ type: 'lnkConclusion', fieldKey: 'method', columnFilters: { project: 'PROJECT', stage: 'LNK' }, gridSearch: 'CONCLUSION' })
    expect(scope.columnFilters).toEqual(original)
    expect(documentMethodCountQuery({ ...scope, documentId: null })).toEqual(base)
    for (const change of [
      { columnFilters: { ...scope.columnFilters, project: 'OTHER' } },
      { columnFilters: { ...scope.columnFilters, stage: 'TVMT' } },
      { gridSearch: 'OTHER' }, { documentId: 42 }, { type: 'lnkRequest' as const },
    ]) {
      const next = documentMethodCountQuery({ ...scope, ...change })
      expect(next.request).not.toEqual(base.request)
      expect(next.queryKey).not.toEqual(base.queryKey)
    }
    expect(documentMethodCountQuery({ ...scope, viewId: 'another-view' }).queryKey).not.toEqual(base.queryKey)
  })
})
