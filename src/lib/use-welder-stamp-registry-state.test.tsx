import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmActionProvider } from '@/lib/confirm-action-context'
import { useWelderStampRegistryState } from '@/lib/use-welder-stamp-registry-state'

const serverMocks = vi.hoisted(() => ({
  loadWelderStampRegistrySnapshot: vi.fn(),
  saveWelderStampRecords: vi.fn(),
  saveWelderStampSuspensionRecords: vi.fn(),
}))

vi.mock('@/server/welder-stamps', () => serverMocks)

describe('useWelderStampRegistryState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serverMocks.loadWelderStampRegistrySnapshot.mockResolvedValue({
      stamps: [],
      suspensions: [],
      revision: 'empty',
    })
  })

  it('does not load the registry until the active section needs it', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ConfirmActionProvider>{children}</ConfirmActionProvider>
      </QueryClientProvider>
    )
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useWelderStampRegistryState({ enabled, setMessage: vi.fn() }),
      { initialProps: { enabled: false }, wrapper },
    )

    expect(serverMocks.loadWelderStampRegistrySnapshot).not.toHaveBeenCalled()

    rerender({ enabled: true })

    await waitFor(() => expect(serverMocks.loadWelderStampRegistrySnapshot).toHaveBeenCalledTimes(1))
  })
})
