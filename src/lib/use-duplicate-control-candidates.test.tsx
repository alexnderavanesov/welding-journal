import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useDuplicateControlCandidates,
  useDuplicateControlRowsByIds,
} from '@/lib/use-duplicate-control-candidates'
import { useDuplicateControls } from '@/lib/use-duplicate-controls'

const serverMocks = vi.hoisted(() => ({
  deleteDuplicateControl: vi.fn(),
  listDuplicateControlCandidatePage: vi.fn(),
  listDuplicateControlCandidateRowsByIds: vi.fn(),
  listDuplicateControlRegistryPage: vi.fn(),
  saveDuplicateControls: vi.fn(),
}))

vi.mock('@/server/duplicate-controls', () => serverMocks)

describe('duplicate-control bounded queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serverMocks.listDuplicateControlCandidatePage.mockImplementation(({ data }) => Promise.resolve({
      rows: [{ id: data.page, joint: `F${data.page}` }],
      ...(data.page === 1 ? { totalCount: 250 } : {}),
      page: data.page,
      pageSize: data.pageSize,
      hasMore: data.page < 2,
    }))
    serverMocks.listDuplicateControlRegistryPage.mockImplementation(({ data }) => Promise.resolve({
      rows: [],
      ...(data.page === 1 ? { totalCount: 0 } : {}),
      page: data.page,
      pageSize: data.pageSize,
      hasMore: false,
    }))
    serverMocks.listDuplicateControlCandidateRowsByIds.mockImplementation(({ data }) => Promise.resolve(
      data.ids.map((id: number) => ({ id, joint: `F${id}` })),
    ))
  })

  it('loads one candidate page only after the dialog is enabled and ignores focus/reconnect', async () => {
    const queryClient = createQueryClient()
    const { result, rerender } = renderHook(
      ({ enabled, search }: { enabled: boolean; search: string }) =>
        useDuplicateControlCandidates({ enabled, search }),
      {
        initialProps: { enabled: false, search: '' },
        wrapper: createWrapper(queryClient),
      },
    )

    expect(serverMocks.listDuplicateControlCandidatePage).not.toHaveBeenCalled()
    rerender({ enabled: true, search: 'F' })
    await waitFor(() => expect(serverMocks.listDuplicateControlCandidatePage).toHaveBeenCalledTimes(1))
    expect(serverMocks.listDuplicateControlCandidatePage).toHaveBeenLastCalledWith({
      data: { search: 'F', page: 1, pageSize: 100 },
    })
    await waitFor(() => expect(result.current.totalCount).toBe(250))

    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(serverMocks.listDuplicateControlCandidatePage).toHaveBeenCalledTimes(1)

    act(() => result.current.loadMore())
    await waitFor(() => expect(serverMocks.listDuplicateControlCandidatePage).toHaveBeenCalledTimes(2))
    expect(serverMocks.listDuplicateControlCandidatePage).toHaveBeenLastCalledWith({
      data: { search: 'F', page: 2, pageSize: 100 },
    })
    await waitFor(() => expect(result.current.rows.map((row) => row.id)).toEqual([1, 2]))
  })

  it('does not request the complete controls registry until its section is expanded', async () => {
    const queryClient = createQueryClient()
    const { rerender } = renderHook(
      ({ registryEnabled }: { registryEnabled: boolean }) => useDuplicateControls({ registryEnabled }),
      {
        initialProps: { registryEnabled: false },
        wrapper: createWrapper(queryClient),
      },
    )

    expect(serverMocks.listDuplicateControlRegistryPage).not.toHaveBeenCalled()
    rerender({ registryEnabled: true })
    await waitFor(() => expect(serverMocks.listDuplicateControlRegistryPage).toHaveBeenCalledTimes(1))
    expect(serverMocks.listDuplicateControlRegistryPage).toHaveBeenCalledWith({
      data: { page: 1, pageSize: 100 },
    })

    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(serverMocks.listDuplicateControlRegistryPage).toHaveBeenCalledTimes(1)
  })

  it('loads missing selected rows in one narrow ID request without focus/reconnect repeats', async () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(
      () => useDuplicateControlRowsByIds([9, 4, 9]),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => expect(serverMocks.listDuplicateControlCandidateRowsByIds).toHaveBeenCalledTimes(1))
    expect(serverMocks.listDuplicateControlCandidateRowsByIds).toHaveBeenCalledWith({
      data: { ids: [9, 4] },
    })
    await waitFor(() => expect(result.current.data?.map((row) => row.id)).toEqual([9, 4]))

    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(serverMocks.listDuplicateControlCandidateRowsByIds).toHaveBeenCalledTimes(1)
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
