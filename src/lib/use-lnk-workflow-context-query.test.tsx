import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useLnkWorkflowRowsQuery,
  useLnkWorkflowSummaryQuery,
} from '@/lib/use-lnk-workflow-context-query'
import {
  invalidateWeldJoints,
  LNK_WORKFLOW_ROWS_QUERY_KEY,
} from '@/lib/weld-query-utils'
import type { LnkWorkflowRowsRequest } from '@/server/weld-contracts'

const serverMocks = vi.hoisted(() => ({
  getLnkWorkflowSummary: vi.fn(),
  listLnkWorkflowRows: vi.fn(),
}))

vi.mock('@/server/weld-read-api', () => serverMocks)

describe('LNK workflow query load policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serverMocks.getLnkWorkflowSummary.mockResolvedValue({
      requestNames: [],
      requestOptions: [],
      pendingPrimaryResultRowCount: 0,
      primaryResultRowCount: 0,
      preHeatTreatmentRequestRowCount: 0,
      preHeatTreatmentResultRowCount: 0,
    })
    serverMocks.listLnkWorkflowRows.mockResolvedValue([])
  })

  it('coalesces summary and equivalent scoped row requests across rerenders', async () => {
    const queryClient = createQueryClient()
    const { rerender } = renderHook(
      ({ request }: { request: LnkWorkflowRowsRequest }) => {
        useLnkWorkflowSummaryQuery({ enabled: true })
        useLnkWorkflowRowsQuery({ request })
      },
      {
        initialProps: { request: { scope: 'resultRegistry', rowIds: [9, 2, 9] } },
        wrapper: createWrapper(queryClient),
      },
    )

    await waitFor(() => {
      expect(serverMocks.getLnkWorkflowSummary).toHaveBeenCalledTimes(1)
      expect(serverMocks.listLnkWorkflowRows).toHaveBeenCalledTimes(1)
    })
    expect(serverMocks.listLnkWorkflowRows).toHaveBeenCalledWith({
      data: { scope: 'resultRegistry', rowIds: [2, 9] },
    })

    rerender({ request: { scope: 'resultRegistry', rowIds: [2, 9] } })
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(serverMocks.getLnkWorkflowSummary).toHaveBeenCalledTimes(1)
    expect(serverMocks.listLnkWorkflowRows).toHaveBeenCalledTimes(1)
  })

  it('issues one new row request when the modal scope changes', async () => {
    const queryClient = createQueryClient()
    const { rerender } = renderHook(
      ({ request }: { request: LnkWorkflowRowsRequest | null }) =>
        useLnkWorkflowRowsQuery({ request }),
      {
        initialProps: { request: null } as { request: LnkWorkflowRowsRequest | null },
        wrapper: createWrapper(queryClient),
      },
    )
    expect(serverMocks.listLnkWorkflowRows).not.toHaveBeenCalled()

    rerender({ request: { scope: 'requestCandidates', rowIds: null } })
    await waitFor(() => expect(serverMocks.listLnkWorkflowRows).toHaveBeenCalledTimes(1))

    rerender({ request: { scope: 'resultCandidates', rowIds: null } })
    await waitFor(() => expect(serverMocks.listLnkWorkflowRows).toHaveBeenCalledTimes(2))
  })

  it('refetches an invalidated scope when its modal is reopened', async () => {
    const queryClient = createQueryClient()
    const request = { scope: 'requestCandidates', rowIds: null } as const
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useLnkWorkflowRowsQuery({ request: active ? request : null }),
      {
        initialProps: { active: true },
        wrapper: createWrapper(queryClient),
      },
    )
    await waitFor(() => expect(serverMocks.listLnkWorkflowRows).toHaveBeenCalledTimes(1))

    rerender({ active: false })
    await queryClient.invalidateQueries({
      queryKey: LNK_WORKFLOW_ROWS_QUERY_KEY,
      refetchType: 'none',
    })
    rerender({ active: true })

    await waitFor(() => expect(serverMocks.listLnkWorkflowRows).toHaveBeenCalledTimes(2))
  })

  it('does not refetch a scoped query after its modal closes', async () => {
    const queryClient = createQueryClient()
    const request = { scope: 'requestCandidates', rowIds: null } as const
    const { result } = renderHook(() => {
      const client = useQueryClient()
      const [activeRequest, setActiveRequest] = useState<LnkWorkflowRowsRequest | null>(request)
      useLnkWorkflowRowsQuery({ request: activeRequest })
      return async () => {
        setActiveRequest(null)
        await invalidateWeldJoints(client)
      }
    }, { wrapper: createWrapper(queryClient) })
    await waitFor(() => expect(serverMocks.listLnkWorkflowRows).toHaveBeenCalledTimes(1))

    await act(() => result.current())
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(serverMocks.listLnkWorkflowRows).toHaveBeenCalledTimes(1)
  })

  it('refreshes an open request manager exactly once after a correction', async () => {
    const queryClient = createQueryClient()
    renderHook(() => {
      useLnkWorkflowSummaryQuery({ enabled: true })
      useLnkWorkflowRowsQuery({
        request: { scope: 'requestRegistry', rowIds: null },
      })
    }, { wrapper: createWrapper(queryClient) })
    await waitFor(() => {
      expect(serverMocks.getLnkWorkflowSummary).toHaveBeenCalledTimes(1)
      expect(serverMocks.listLnkWorkflowRows).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      invalidateWeldJoints(
        queryClient,
        { upsertRows: [{ id: 1, joint: 'F1' }] },
        { refetchLnkWorkflow: true },
      )
    })
    await waitFor(() => {
      expect(serverMocks.getLnkWorkflowSummary).toHaveBeenCalledTimes(2)
      expect(serverMocks.listLnkWorkflowRows).toHaveBeenCalledTimes(2)
    })

    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(serverMocks.getLnkWorkflowSummary).toHaveBeenCalledTimes(2)
    expect(serverMocks.listLnkWorkflowRows).toHaveBeenCalledTimes(2)
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
