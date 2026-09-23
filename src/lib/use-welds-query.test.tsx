import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useWeldFinalStatusContextQuery,
  useWeldReportContextQuery,
  useWeldsQuery,
} from '@/lib/use-welds-query'

const serverMocks = vi.hoisted(() => ({
  listWeldFinalStatusContextKeys: vi.fn(),
  listWeldJointSnapshotPage: vi.fn(),
  listWeldReportContextRows: vi.fn(),
}))

vi.mock('@/server/weld-read-api', () => ({
  ...serverMocks,
  WELD_SNAPSHOT_BATCH_SIZE: 1_000,
}))

describe('large weld query load policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serverMocks.listWeldFinalStatusContextKeys.mockResolvedValue([])
    serverMocks.listWeldJointSnapshotPage.mockResolvedValue({
      rows: [],
      nextAfterId: null,
      hasMore: false,
    })
    serverMocks.listWeldReportContextRows.mockResolvedValue([])
  })

  it('does not load final-status context until enabled and ignores focus/reconnect', async () => {
    const queryClient = createQueryClient()
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useWeldFinalStatusContextQuery({ enabled }),
      {
        initialProps: { enabled: false },
        wrapper: createWrapper(queryClient),
      },
    )
    expect(serverMocks.listWeldFinalStatusContextKeys).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await waitFor(() => expect(serverMocks.listWeldFinalStatusContextKeys).toHaveBeenCalledTimes(1))
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(serverMocks.listWeldFinalStatusContextKeys).toHaveBeenCalledTimes(1)
  })

  it('does not repeat complete snapshots or report contexts on focus/reconnect', async () => {
    const queryClient = createQueryClient()
    renderHook(() => {
      useWeldsQuery({ enabled: true })
      useWeldReportContextQuery({ enabled: true, report: 'lnk' })
    }, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(serverMocks.listWeldJointSnapshotPage).toHaveBeenCalledTimes(1)
      expect(serverMocks.listWeldReportContextRows).toHaveBeenCalledTimes(1)
    })
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(serverMocks.listWeldJointSnapshotPage).toHaveBeenCalledTimes(1)
    expect(serverMocks.listWeldReportContextRows).toHaveBeenCalledTimes(1)
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
