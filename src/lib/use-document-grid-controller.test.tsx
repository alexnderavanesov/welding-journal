import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentGridController } from './use-document-grid-controller'
import type { DocumentHistoryGridRequest, DocumentHistoryGridResult } from './document-history-grid'
import { GENERATED_DOCUMENT_HISTORY_QUERY_KEY } from './weld-query-utils'

type Row = { id: number; title: string }
const revision = 'a'.repeat(32)
const response = (rows: Row[]): DocumentHistoryGridResult<Row> => ({ rows, rowCount: rows.length, total: rows.length, revision })
function setup(load: (request: DocumentHistoryGridRequest) => Promise<DocumentHistoryGridResult<Row>>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, ...renderHook(({ scope }) => useDocumentGridController<Row>('generated:checklist', load, scope), { initialProps: { scope: 'first' }, wrapper }) }
}
const storageKey = 'welding-journal:documents:session:v1:generated:checklist'
describe('document identity selection and action hydration', () => {
  beforeEach(() => sessionStorage.clear())
  it('restores a full identity selection without loading cards or truncating it', () => {
    const ids = Array.from({ length: 200_000 }, (_, i) => i + 1)
    sessionStorage.setItem(storageKey, JSON.stringify({ selectedDocumentIds: [...ids, 3], staleSnapshot: true }))
    const load = vi.fn(), { result } = setup(load)
    expect(result.current.selectedDocuments.map(row => row.id)).toEqual(ids)
    expect(load).not.toHaveBeenCalled()
  })
  it('keeps hidden selections on filter changes and invalidation, and reads current cards only on action', async () => {
    const load = vi.fn().mockResolvedValue(response([{ id: 5, title: 'After save' }]))
    const { result, rerender, client } = setup(load)
    act(() => result.current.setSelectedDocuments([{ id: 5 }]))
    rerender({ scope: 'other filter' })
    await act(async () => { await client.invalidateQueries({ queryKey: GENERATED_DOCUMENT_HISTORY_QUERY_KEY }) })
    expect(load).not.toHaveBeenCalled()
    await act(async () => expect(await result.current.resolveDocuments()).toEqual([{ id: 5, title: 'After save' }]))
    expect(load).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ selectedIds: [5], selectionOnly: true }))
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual({ selectedDocumentIds: [5] })
    expect(client.getQueryCache().getAll()).toHaveLength(1)
  })
  it.each(['selection', 'scope', 'unmount'])('cancels an action without stale publication after %s changes', async reason => {
    let complete!: (value: DocumentHistoryGridResult<Row>) => void
    const load = vi.fn(() => new Promise<DocumentHistoryGridResult<Row>>(resolve => { complete = resolve }))
    const { result, rerender, unmount } = setup(load)
    act(() => result.current.setSelectedDocuments([{ id: 5 }]))
    let operation!: Promise<Row[] | null>
    act(() => { operation = result.current.resolveDocuments() })
    expect(result.current.selectionPending).toBe(true)
    if (reason === 'selection') act(() => result.current.setSelectedDocuments([{ id: 9 }]))
    else if (reason === 'scope') rerender({ scope: 'second' })
    else unmount()
    await act(async () => { complete(response([{ id: 5, title: 'Late response' }])); expect(await operation).toBeNull() })
    if (reason !== 'unmount') expect(result.current.selectedDocuments).toEqual([{ id: reason === 'selection' ? 9 : 5 }])
  })
  it.each([{ ids: [1] }, { ids: [1, 1] }, { ids: [1, 3] }])('never substitutes missing selected documents with response IDs $ids', async ({ ids }) => {
    const load = vi.fn().mockResolvedValue(response(ids.map(id => ({ id, title: 'Document' }))))
    const { result } = setup(load)
    act(() => result.current.setSelectedDocuments([{ id: 1 }, { id: 2 }]))
    await act(async () => expect(await result.current.resolveDocuments()).toBeNull())
    expect(result.current.selectedDocuments).toEqual([{ id: 1 }, { id: 2 }])
    expect(result.current.selectionError).toContain('больше недоступна')
  })
  it('pins sequential hydration batches and publishes no partial action after a later failure', async () => {
    const rows = Array.from({ length: 10_001 }, (_, i) => ({ id: i + 1, title: `Document ${i + 1}` }))
    const load = vi.fn().mockResolvedValueOnce(response(rows.slice(0, 10_000))).mockRejectedValueOnce(new Error('changed'))
    const { result } = setup(load)
    act(() => result.current.setSelectedDocuments(rows))
    await act(async () => expect(await result.current.resolveDocuments()).toBeNull())
    expect(load).toHaveBeenCalledTimes(2)
    expect(load.mock.calls[0][0].selectedIds).toHaveLength(10_000)
    expect(load.mock.calls[1][0]).toMatchObject({ selectedIds: [10_001], revision })
    expect(result.current.selectedDocuments).toHaveLength(10_001)
    expect(result.current.selectionError).toBe('changed')
    load.mockImplementation((request: DocumentHistoryGridRequest) => Promise.resolve(response(rows.filter(row => request.selectedIds?.includes(row.id)))))
    await act(async () => expect(await result.current.resolveDocuments()).toEqual(rows))
    expect(result.current.selectionPending).toBe(false)
    expect(result.current.selectionError).toBeNull()
  })
})
