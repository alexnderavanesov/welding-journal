import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentGridController } from './use-document-grid-controller'
import type { DocumentHistoryGridRequest, DocumentHistoryGridResult } from './document-history-grid'
import { GENERATED_DOCUMENT_HISTORY_QUERY_KEY } from './weld-query-utils'

type Row = { id: number; title: string }
const response = (rows: Row[]): DocumentHistoryGridResult<Row> => ({ rows, rowCount: rows.length, total: rows.length })
function setup(load: (request: DocumentHistoryGridRequest) => Promise<DocumentHistoryGridResult<Row>>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, ...renderHook(() => useDocumentGridController<Row>('generated:checklist', load), { wrapper }) }
}
const storageKey = 'welding-journal:documents:session:v1:generated:checklist'

describe('document grid controller', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('restores only saved IDs in one bounded request and stores no stale snapshots', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify({ selectedDocumentIds: [3, 4, 3], pageSize: 100, visibleLimit: 1000 }))
    const load = vi.fn().mockResolvedValue(response([{ id: 4, title: 'Current document' }]))
    const { result } = setup(load)
    await waitFor(() => expect(result.current.selectedDocuments).toEqual([{ id: 4, title: 'Current document' }]))
    expect(load).toHaveBeenCalledTimes(1)
    expect(load.mock.calls[0][0]).toMatchObject({ selectedIds: [3, 4], selectionOnly: true })
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual({ selectedDocumentIds: [4] })
  })

  it('does not overwrite a new operator selection with a delayed restore response', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify({ selectedDocumentIds: [3] }))
    let complete!: (result: DocumentHistoryGridResult<Row>) => void
    const load = vi.fn(() => new Promise<DocumentHistoryGridResult<Row>>(resolve => { complete = resolve }))
    const { result } = setup(load)
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    act(() => result.current.setSelectedDocuments([{ id: 9, title: 'Chosen now' }]))
    await act(async () => complete(response([{ id: 3, title: 'Old choice' }])))
    expect(result.current.selectedDocuments.map(row => row.id)).toEqual([9])
    expect(JSON.parse(sessionStorage.getItem(storageKey)!).selectedDocumentIds).toEqual([9])
  })

  it('refreshes exact selected snapshots on existing document invalidation without a second row cache', async () => {
    const load = vi.fn().mockResolvedValue(response([{ id: 5, title: 'After save' }]))
    const { result, client } = setup(load)
    act(() => result.current.setSelectedDocuments([{ id: 5, title: 'Before save' }]))
    expect(load).not.toHaveBeenCalled()
    await act(async () => { await client.invalidateQueries({ queryKey: GENERATED_DOCUMENT_HISTORY_QUERY_KEY }) })
    await waitFor(() => expect(result.current.selectedDocuments[0]?.title).toBe('After save'))
    expect(load).toHaveBeenCalledTimes(1)
    expect(client.getQueryCache().getAll()).toHaveLength(1)
    expect(typeof client.getQueryCache().getAll()[0].state.data).toBe('number')
  })

  it('preserves restore IDs after a failure and lets explicit retry recover', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify({ selectedDocumentIds: [7] }))
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(response([{ id: 7, title: 'Recovered' }]))
    const { result } = setup(load)
    await waitFor(() => expect(result.current.selectionError).toBeTruthy())
    expect(JSON.parse(sessionStorage.getItem(storageKey)!).selectedDocumentIds).toEqual([7])
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.selectedDocuments.map(row => row.id)).toEqual([7]))
    expect(result.current.selectionError).toBeNull()
  })

  it('refreshes off-block selected snapshots even when the visible block responds first', async () => {
    let complete!: (value: DocumentHistoryGridResult<Row>) => void
    const load = vi.fn(() => new Promise<DocumentHistoryGridResult<Row>>(resolve => { complete = resolve }))
    const { result, client } = setup(load)
    act(() => result.current.setSelectedDocuments([{ id: 5, title: 'Old visible' }, { id: 6, title: 'Old off-block' }]))
    await act(async () => { await client.invalidateQueries({ queryKey: GENERATED_DOCUMENT_HISTORY_QUERY_KEY }) })
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    expect(result.current.selectionPending).toBe(true)
    // AG receives its current block first and replaces only that row's snapshot.
    // This must not invalidate the concurrent exact-ID hydration of other blocks.
    act(() => result.current.setSelectedDocuments([{ id: 5, title: 'Fresh visible block' }, { id: 6, title: 'Old off-block' }]))
    await act(async () => complete(response([{ id: 5, title: 'Fresh visible' }, { id: 6, title: 'Fresh off-block' }])))
    expect(result.current.selectedDocuments).toEqual([{ id: 5, title: 'Fresh visible' }, { id: 6, title: 'Fresh off-block' }])
    expect(result.current.selectionPending).toBe(false)
    expect(result.current.selectionError).toBeNull()
  })

  it('does not resurrect deselections or overwrite new choices during snapshot refresh', async () => {
    let complete!: (value: DocumentHistoryGridResult<Row>) => void
    const load = vi.fn(() => new Promise<DocumentHistoryGridResult<Row>>(resolve => { complete = resolve }))
    const { result, client } = setup(load)
    act(() => result.current.setSelectedDocuments([{ id: 5, title: 'Remove me' }, { id: 6, title: 'Refresh me' }, { id: 7, title: 'Deleted remotely' }]))
    await act(async () => { await client.invalidateQueries({ queryKey: GENERATED_DOCUMENT_HISTORY_QUERY_KEY }) })
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    act(() => result.current.setSelectedDocuments([{ id: 6, title: 'Refresh me' }, { id: 7, title: 'Deleted remotely' }, { id: 9, title: 'New explicit choice' }]))
    await act(async () => complete(response([{ id: 5, title: 'Must stay deselected' }, { id: 6, title: 'Fresh retained' }])))
    expect(result.current.selectedDocuments).toEqual([{ id: 6, title: 'Fresh retained' }, { id: 9, title: 'New explicit choice' }])
    expect(JSON.parse(sessionStorage.getItem(storageKey)!).selectedDocumentIds).toEqual([6, 9])
  })

  it('exposes pending/error gates until exact-selection retry succeeds', async () => {
    const pending: Array<{ resolve: (value: DocumentHistoryGridResult<Row>) => void; reject: (error: Error) => void }> = []
    const load = vi.fn(() => new Promise<DocumentHistoryGridResult<Row>>((resolve, reject) => pending.push({ resolve, reject })))
    const { result, client } = setup(load)
    act(() => result.current.setSelectedDocuments([{ id: 5, title: 'Existing snapshot' }]))
    await act(async () => { await client.invalidateQueries({ queryKey: GENERATED_DOCUMENT_HISTORY_QUERY_KEY }) })
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    expect(result.current.selectionPending).toBe(true)
    expect(result.current.selectionError).toBeNull()
    await act(async () => pending[0].reject(new Error('offline')))
    expect(result.current.selectionPending).toBe(false)
    expect(result.current.selectionError).toContain('Обновите историю перед действием')
    expect(result.current.selectedDocuments).toEqual([{ id: 5, title: 'Existing snapshot' }])
    act(() => result.current.refresh())
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(result.current.selectionPending).toBe(true)
    expect(result.current.selectionError).toBeNull()
    await act(async () => pending[1].resolve(response([{ id: 5, title: 'Confirmed after retry' }])))
    expect(result.current.selectionPending).toBe(false)
    expect(result.current.selectionError).toBeNull()
    expect(result.current.selectedDocuments).toEqual([{ id: 5, title: 'Confirmed after retry' }])
  })

  it('restores all 10001 IDs in two sequential bounded requests with one complete update', async () => {
    const ids = Array.from({ length: 10_001 }, (_, index) => index + 1)
    sessionStorage.setItem(storageKey, JSON.stringify({ selectedDocumentIds: ids }))
    const pending: Array<(value: DocumentHistoryGridResult<Row>) => void> = []
    const load = vi.fn((_request: DocumentHistoryGridRequest) => new Promise<DocumentHistoryGridResult<Row>>(resolve => pending.push(resolve)))
    const { result } = setup(load)
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    expect(load.mock.calls[0][0]).toMatchObject({ selectedIds: ids.slice(0, 10_000), selectionOnly: true })
    expect(result.current.selectionPending).toBe(true)
    expect(result.current.selectedDocuments).toEqual([])
    await act(async () => pending[0](response(ids.slice(0, 10_000).map(id => ({ id, title: `Current ${id}` })))))
    expect(load).toHaveBeenCalledTimes(2)
    expect(load.mock.calls[1][0]).toMatchObject({ selectedIds: [10_001], selectionOnly: true })
    // The first batch must not publish a truncated selection or rewrite storage.
    expect(result.current.selectionPending).toBe(true)
    expect(result.current.selectedDocuments).toEqual([])
    expect(JSON.parse(sessionStorage.getItem(storageKey)!).selectedDocumentIds).toEqual(ids)
    await act(async () => pending[1](response([{ id: 10_001, title: 'Current 10001' }])))
    expect(result.current.selectedDocuments.map(row => row.id)).toEqual(ids)
    expect(JSON.parse(sessionStorage.getItem(storageKey)!).selectedDocumentIds).toEqual(ids)
    expect(result.current.selectionPending).toBe(false)
    expect(result.current.selectionError).toBeNull()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps a large selection atomic and actions gated when its second hydration batch fails', async () => {
    const rows = Array.from({ length: 10_001 }, (_, index) => ({ id: index + 1, title: `Before ${index + 1}` }))
    const pending: Array<{ resolve: (value: DocumentHistoryGridResult<Row>) => void; reject: (error: Error) => void }> = []
    const load = vi.fn((_request: DocumentHistoryGridRequest) => new Promise<DocumentHistoryGridResult<Row>>((resolve, reject) => pending.push({ resolve, reject })))
    const { result, client } = setup(load)
    act(() => result.current.setSelectedDocuments(rows))
    await act(async () => { await client.invalidateQueries({ queryKey: GENERATED_DOCUMENT_HISTORY_QUERY_KEY }) })
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    const fresh = rows.map(row => ({ ...row, title: `After ${row.id}` }))
    await act(async () => pending[0].resolve(response(fresh.slice(0, 10_000))))
    expect(load).toHaveBeenCalledTimes(2)
    expect(result.current.selectedDocuments).toEqual(rows)
    expect(result.current.selectionPending).toBe(true)
    await act(async () => pending[1].reject(new Error('Second batch offline')))
    expect(result.current.selectedDocuments).toEqual(rows)
    expect(result.current.selectionPending).toBe(false)
    expect(result.current.selectionError).toContain('Обновите историю перед действием')
    expect(JSON.parse(sessionStorage.getItem(storageKey)!).selectedDocumentIds).toEqual(rows.map(row => row.id))
    act(() => result.current.refresh())
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3))
    expect(result.current.selectionPending).toBe(true)
    expect(result.current.selectionError).toBeNull()
    await act(async () => pending[2].resolve(response(fresh.slice(0, 10_000))))
    expect(load).toHaveBeenCalledTimes(4)
    expect(result.current.selectedDocuments).toEqual(rows)
    await act(async () => pending[3].resolve(response(fresh.slice(10_000))))
    expect(result.current.selectedDocuments).toEqual(fresh)
    expect(result.current.selectionPending).toBe(false)
    expect(result.current.selectionError).toBeNull()
  })

  it('cancels the old batch sequence on a scope change without mixing snapshot scopes', async () => {
    const ids = Array.from({ length: 10_001 }, (_, index) => index + 1)
    sessionStorage.setItem(storageKey, JSON.stringify({ selectedDocumentIds: ids }))
    let completeOld!: (value: DocumentHistoryGridResult<Row>) => void
    const oldLoad = vi.fn((_request: DocumentHistoryGridRequest) => new Promise<DocumentHistoryGridResult<Row>>(resolve => { completeOld = resolve }))
    const currentLoad = vi.fn((request: DocumentHistoryGridRequest) => Promise.resolve(response((request.selectedIds ?? []).map(id => ({ id: Number(id), title: 'New scope' })))))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result, rerender } = renderHook(({ scope }) => useDocumentGridController<Row>('generated:checklist', scope === 'old' ? oldLoad : currentLoad, scope), { initialProps: { scope: 'old' }, wrapper })
    await waitFor(() => expect(oldLoad).toHaveBeenCalledTimes(1))
    rerender({ scope: 'current' })
    await waitFor(() => expect(result.current.selectedDocuments).toHaveLength(10_001))
    expect(currentLoad).toHaveBeenCalledTimes(2)
    await act(async () => completeOld(response(ids.slice(0, 10_000).map(id => ({ id, title: 'Stale scope' })))))
    expect(oldLoad).toHaveBeenCalledTimes(1)
    expect(result.current.selectedDocuments.every(row => row.title === 'New scope')).toBe(true)
    expect(result.current.selectionPending).toBe(false)
    expect(result.current.selectionError).toBeNull()
  })
})
