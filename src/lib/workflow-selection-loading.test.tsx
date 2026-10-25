import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLnkWorkflowRowsQuery } from './use-lnk-workflow-context-query'
import { usePstoWorkflowRowsQuery } from './use-psto-workflow-context-query'
import type { WeldRow } from './dispatcher-types'

const api = vi.hoisted(() => ({ listLnkWorkflowRows: vi.fn(), listPstoWorkflowRows: vi.fn() }))
vi.mock('@/server/weld-read-api', () => api)
type Request = { scope: 'requestCandidates'; rowIds: null; includeRowIds: number[]; search?: string }
function pending() {
  let resolve!: (rows: WeldRow[]) => void
  let reject!: (error: Error) => void
  const promise = new Promise<WeldRow[]>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const rows = (...ids: number[]) => ids.map(id => ({ id }) as WeldRow)

for (const [name, useRows, mock] of [
  ['ЛНК', useLnkWorkflowRowsQuery, api.listLnkWorkflowRows],
  ['ПСТО', usePstoWorkflowRowsQuery, api.listPstoWorkflowRows],
] as const) describe(`${name}: fresh workflow context`, () => {
  beforeEach(() => vi.resetAllMocks())
  const setup = (initialRequest: Request) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return renderHook(() => {
      const [request, setRequest] = useState<Request | null>(initialRequest)
      return { ...useRows({ request }), setRequest }
    }, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
  }

  it('does not validate selection against cached/placeholder rows or a failed refresh; checkboxes stay local', async () => {
    mock.mockResolvedValue(rows(1, 2))
    const request: Request = { scope: 'requestCandidates', rowIds: null, includeRowIds: [1] }
    const { result } = setup(request)
    await waitFor(() => expect(result.current.isContextReady).toBe(true))
    const fresh = pending()
    mock.mockReturnValueOnce(fresh.promise)
    act(() => result.current.setRequest(null))
    act(() => result.current.setRequest(request))
    expect(result.current.isContextReady).toBe(false)
    await act(async () => fresh.resolve(rows(1, 2)))
    await waitFor(() => expect(result.current.isContextReady).toBe(true))
    act(() => result.current.setRequest({ ...request, includeRowIds: [1, 2] }))
    expect(mock).toHaveBeenCalledTimes(2)
    const search = pending()
    mock.mockReturnValueOnce(search.promise)
    act(() => result.current.setRequest({ ...request, includeRowIds: [1, 2], search: 'other' }))
    expect(result.current.isPlaceholderData).toBe(true)
    expect(result.current.isContextReady).toBe(false)
    await act(async () => search.reject(new Error('network')))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.isContextReady).toBe(false)
    expect(mock).toHaveBeenCalledTimes(3)
    expect(mock.mock.calls.at(-1)?.[0].data.includeRowIds).toEqual([1, 2])
  })

  it('a cancelled opening cannot supply the next dialog with another selection', async () => {
    const old = pending(), next = pending()
    mock.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const request: Request = { scope: 'requestCandidates', rowIds: null, includeRowIds: [1] }
    const { result } = setup(request)
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1))
    act(() => result.current.setRequest(null))
    act(() => result.current.setRequest({ ...request, includeRowIds: [999] }))
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(2))
    await act(async () => next.resolve(rows(999)))
    await waitFor(() => expect(result.current.isContextReady).toBe(true))
    await act(async () => old.resolve(rows(1)))
    expect(result.current.data).toEqual(rows(999))
  })

  it('returning to an in-flight filter carries checkboxes chosen in the meantime', async () => {
    const old = pending()
    mock.mockReturnValueOnce(old.promise).mockResolvedValue(rows(1, 2))
    const request: Request = { scope: 'requestCandidates', rowIds: null, includeRowIds: [1], search: 'A' }
    const { result } = setup(request)
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1))
    act(() => result.current.setRequest({ ...request, search: 'B' }))
    await waitFor(() => expect(result.current.isContextReady).toBe(true))
    act(() => result.current.setRequest({ ...request, search: 'B', includeRowIds: [1, 2] }))
    expect(mock).toHaveBeenCalledTimes(2)
    act(() => result.current.setRequest({ ...request, includeRowIds: [1, 2] }))
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(3))
    expect(mock.mock.calls.at(-1)?.[0].data).toMatchObject({ search: 'A', includeRowIds: [1, 2] })
    await waitFor(() => expect(result.current.isContextReady).toBe(true))
    await act(async () => old.resolve(rows(1)))
    expect(result.current.data).toEqual(rows(1, 2))
  })
})
