import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  usePstoWorkflowRequestOptionsQuery,
  usePstoWorkflowRowsQuery,
  usePstoWorkflowSummaryQuery,
} from '@/lib/use-psto-workflow-context-query'
import {
  invalidateWeldJoints,
  PSTO_WORKFLOW_ROWS_QUERY_KEY,
} from '@/lib/weld-query-utils'
import type { PstoWorkflowRowsRequest } from '@/server/weld-contracts'

const serverMocks = vi.hoisted(() => ({
  getPstoWorkflowSummary: vi.fn(),
  getPstoWorkflowRequestOptions: vi.fn(),
  listPstoWorkflowRows: vi.fn(),
}))

vi.mock('@/server/weld-read-api', () => serverMocks)

describe('PSTO workflow query load policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serverMocks.getPstoWorkflowSummary.mockResolvedValue({
      requestCandidateCount: 0,
      requestRegistryCount: 0,
      resultCandidateCount: 0,
      resultRegistryCount: 0,
      tvmtRequestCandidateCount: 0,
      tvmtResultCandidateCount: 0,
    })
    serverMocks.listPstoWorkflowRows.mockResolvedValue([])
    serverMocks.getPstoWorkflowRequestOptions.mockResolvedValue({ options: [], hasMore: false })
  })

  it('does not request rows or a summary while the workflow UI is closed', async () => {
    const queryClient = createQueryClient()
    renderHook(() => {
      usePstoWorkflowSummaryQuery({ enabled: false })
      usePstoWorkflowRequestOptionsQuery({ enabled: false, search: '' })
      usePstoWorkflowRowsQuery({ request: null })
    }, { wrapper: createWrapper(queryClient) })

    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(serverMocks.getPstoWorkflowSummary).not.toHaveBeenCalled()
    expect(serverMocks.getPstoWorkflowRequestOptions).not.toHaveBeenCalled()
    expect(serverMocks.listPstoWorkflowRows).not.toHaveBeenCalled()
  })

  it('loads bounded request options once per search and ignores focus/reconnect', async () => {
    const queryClient = createQueryClient()
    const { rerender } = renderHook(
      ({ search }: { search: string }) =>
        usePstoWorkflowRequestOptionsQuery({ enabled: true, search }),
      {
        initialProps: { search: '' },
        wrapper: createWrapper(queryClient),
      },
    )

    await waitFor(() => expect(serverMocks.getPstoWorkflowRequestOptions).toHaveBeenCalledTimes(1))
    rerender({ search: '' })
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(serverMocks.getPstoWorkflowRequestOptions).toHaveBeenCalledTimes(1)

    rerender({ search: 'Линия-17' })
    await waitFor(() => expect(serverMocks.getPstoWorkflowRequestOptions).toHaveBeenCalledTimes(2))
    expect(serverMocks.getPstoWorkflowRequestOptions).toHaveBeenLastCalledWith({
      data: { search: 'Линия-17' },
    })
  })

  it('coalesces equivalent row requests and ignores focus and reconnect events', async () => {
    const queryClient = createQueryClient()
    const { rerender } = renderHook(
      ({ request }: { request: PstoWorkflowRowsRequest }) => {
        usePstoWorkflowSummaryQuery({ enabled: true })
        usePstoWorkflowRowsQuery({ request })
      },
      {
        initialProps: { request: { scope: 'fieldRows', rowIds: [9, 2, 9] } },
        wrapper: createWrapper(queryClient),
      },
    )

    await waitFor(() => {
      expect(serverMocks.getPstoWorkflowSummary).toHaveBeenCalledTimes(1)
      expect(serverMocks.listPstoWorkflowRows).toHaveBeenCalledTimes(1)
    })
    expect(serverMocks.listPstoWorkflowRows).toHaveBeenCalledWith({
      data: { scope: 'fieldRows', rowIds: [2, 9] },
    })

    rerender({ request: { scope: 'fieldRows', rowIds: [2, 9] } })
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(serverMocks.getPstoWorkflowSummary).toHaveBeenCalledTimes(1)
    expect(serverMocks.listPstoWorkflowRows).toHaveBeenCalledTimes(1)
  })

  it('issues exactly one new request when the modal scope changes', async () => {
    const queryClient = createQueryClient()
    const { rerender } = renderHook(
      ({ request }: { request: PstoWorkflowRowsRequest | null }) =>
        usePstoWorkflowRowsQuery({ request }),
      {
        initialProps: { request: null } as { request: PstoWorkflowRowsRequest | null },
        wrapper: createWrapper(queryClient),
      },
    )

    rerender({ request: { scope: 'requestCandidates', rowIds: null } })
    await waitFor(() => expect(serverMocks.listPstoWorkflowRows).toHaveBeenCalledTimes(1))

    rerender({ request: { scope: 'resultCandidates', rowIds: null } })
    await waitFor(() => expect(serverMocks.listPstoWorkflowRows).toHaveBeenCalledTimes(2))
  })

  it('does not refetch candidates for checkbox-only changes', async () => {
    const queryClient = createQueryClient()
    const { rerender } = renderHook(
      ({ request }: { request: PstoWorkflowRowsRequest }) =>
        usePstoWorkflowRowsQuery({ request }),
      {
        initialProps: {
          request: { scope: 'requestCandidates', rowIds: null, includeRowIds: [4] },
        },
        wrapper: createWrapper(queryClient),
      },
    )
    await waitFor(() => expect(serverMocks.listPstoWorkflowRows).toHaveBeenCalledTimes(1))

    rerender({
      request: { scope: 'requestCandidates', rowIds: null, includeRowIds: [4, 6] },
    })
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(serverMocks.listPstoWorkflowRows).toHaveBeenCalledTimes(1)
  })

  it('does not refetch an invalidated row scope after its modal closes', async () => {
    const queryClient = createQueryClient()
    const request = { scope: 'requestCandidates', rowIds: null } as const
    const { result } = renderHook(() => {
      const client = useQueryClient()
      const [activeRequest, setActiveRequest] = useState<PstoWorkflowRowsRequest | null>(request)
      usePstoWorkflowRowsQuery({ request: activeRequest })
      return async () => {
        setActiveRequest(null)
        await invalidateWeldJoints(client)
      }
    }, { wrapper: createWrapper(queryClient) })
    await waitFor(() => expect(serverMocks.listPstoWorkflowRows).toHaveBeenCalledTimes(1))

    await act(() => result.current())
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(serverMocks.listPstoWorkflowRows).toHaveBeenCalledTimes(1)
  })

  it('refetches an open workflow exactly once after a PSTO mutation', async () => {
    const queryClient = createQueryClient()
    renderHook(() => {
      usePstoWorkflowSummaryQuery({ enabled: true })
      usePstoWorkflowRowsQuery({
        request: { scope: 'resultRegistry', rowIds: null },
      })
    }, { wrapper: createWrapper(queryClient) })
    await waitFor(() => {
      expect(serverMocks.getPstoWorkflowSummary).toHaveBeenCalledTimes(1)
      expect(serverMocks.listPstoWorkflowRows).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      invalidateWeldJoints(
        queryClient,
        { upsertRows: [{ id: 1, pstoResult: 'Проведено' }] },
        { refetchPstoWorkflow: true },
      )
    })
    await waitFor(() => {
      expect(serverMocks.getPstoWorkflowSummary).toHaveBeenCalledTimes(2)
      expect(serverMocks.listPstoWorkflowRows).toHaveBeenCalledTimes(2)
    })

    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(serverMocks.getPstoWorkflowSummary).toHaveBeenCalledTimes(2)
    expect(serverMocks.listPstoWorkflowRows).toHaveBeenCalledTimes(2)
  })

  it('refetches an invalidated scope once when its modal is reopened', async () => {
    const queryClient = createQueryClient()
    const request = { scope: 'requestCandidates', rowIds: null } as const
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        usePstoWorkflowRowsQuery({ request: active ? request : null }),
      {
        initialProps: { active: true },
        wrapper: createWrapper(queryClient),
      },
    )
    await waitFor(() => expect(serverMocks.listPstoWorkflowRows).toHaveBeenCalledTimes(1))

    rerender({ active: false })
    await queryClient.invalidateQueries({
      queryKey: PSTO_WORKFLOW_ROWS_QUERY_KEY,
      refetchType: 'none',
    })
    rerender({ active: true })

    await waitFor(() => expect(serverMocks.listPstoWorkflowRows).toHaveBeenCalledTimes(2))
  })
})

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function createWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}
