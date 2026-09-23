import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRemoteWeldFormSuggestions } from '@/lib/use-remote-weld-form-suggestions'

const serverMocks = vi.hoisted(() => ({ listWeldFormSuggestions: vi.fn() }))
vi.mock('@/server/weld-read-api', () => serverMocks)

describe('remote weld-form suggestions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs only one database-backed suggestion request while the draft changes rapidly', async () => {
    let finishFirst: (rows: []) => void = () => {}
    serverMocks.listWeldFormSuggestions
      .mockImplementationOnce(() => new Promise<[]>(resolve => { finishFirst = resolve }))
      .mockResolvedValueOnce([])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const { rerender } = renderHook(
      ({ line }) => useRemoteWeldFormSuggestions({ fieldKey: 'line', draft: { line }, enabled: true }),
      { wrapper, initialProps: { line: 'L' } },
    )

    await waitFor(() => expect(serverMocks.listWeldFormSuggestions).toHaveBeenCalledTimes(1))
    rerender({ line: 'LI' })
    rerender({ line: 'LINE' })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(serverMocks.listWeldFormSuggestions).toHaveBeenCalledTimes(1)

    await act(async () => finishFirst([]))
    await waitFor(() => expect(serverMocks.listWeldFormSuggestions).toHaveBeenCalledTimes(2))
    expect(serverMocks.listWeldFormSuggestions).toHaveBeenLastCalledWith({
      data: { fieldKey: 'line', draft: { line: 'LINE' } },
    })
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(serverMocks.listWeldFormSuggestions).toHaveBeenCalledTimes(2)
  })

  it('does not query while the form field is closed', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    renderHook(() => useRemoteWeldFormSuggestions({ fieldKey: 'line', draft: {}, enabled: false }), { wrapper })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(serverMocks.listWeldFormSuggestions).not.toHaveBeenCalled()
  })
})
