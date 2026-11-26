import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import { useLnkWorkflowRowsQuery } from './use-lnk-workflow-context-query'
import { usePstoWorkflowRowsQuery } from './use-psto-workflow-context-query'

const server = vi.hoisted(() => ({ listLnkWorkflowRows: vi.fn(), listPstoWorkflowRows: vi.fn() }))
vi.mock('@/server/weld-read-api', () => server)

for (const [area, useRows, read] of [
  ['ЛНК', useLnkWorkflowRowsQuery, server.listLnkWorkflowRows],
  ['ПСТО', usePstoWorkflowRowsQuery, server.listPstoWorkflowRows],
] as const) {
  it.each([
    { scope: 'requestCandidates', eligible: true }, { scope: 'requestCandidates', eligible: false },
    { scope: 'resultCandidates', eligible: true }, { scope: 'resultCandidates', eligible: false },
  ] as const)(`${area}: $scope confirms a selection made during a filtered read (still eligible: $eligible)`, async ({ scope, eligible }) => {
    const both = [{ id: 1 }, { id: 2 }]
    let finishSearch!: (rows: typeof both) => void
    let finishConfirmation!: (rows: typeof both) => void
    read.mockReset().mockResolvedValueOnce(both)
      .mockImplementationOnce(() => new Promise(resolve => { finishSearch = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { finishConfirmation = resolve }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result, rerender, unmount } = renderHook(
      ({ search, ids }) => useRows({ request: { scope, rowIds: null, search, includeRowIds: ids } }),
      { initialProps: { search: '', ids: [1] }, wrapper: ({ children }: { children: ReactNode }) =>
        <QueryClientProvider client={client}>{children}</QueryClientProvider> },
    )
    try {
      await waitFor(() => expect(result.current.isContextReady).toBe(true))
      rerender({ search: 'F9101', ids: [1] })
      await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
      expect(result.current.data?.map(row => row.id)).toEqual([1, 2])
      rerender({ search: 'F9101', ids: [1, 2] })
      expect(read).toHaveBeenCalledTimes(2)
      await act(async () => finishSearch([both[0]]))
      await waitFor(() => expect(read).toHaveBeenCalledTimes(3))
      expect(read.mock.lastCall?.[0].data.includeRowIds).toEqual([1, 2])
      expect(result.current.isContextReady).toBe(false)
      expect(result.current.data?.map(row => row.id)).toEqual([1, 2])
      await act(async () => finishConfirmation(eligible ? both : [both[0]]))
      await waitFor(() => expect(result.current.isContextReady).toBe(true))
      expect(result.current.data?.map(row => row.id)).toEqual(eligible ? [1, 2] : [1])
      expect(read).toHaveBeenCalledTimes(3)
    } finally { unmount(); client.clear() }
  })
}
