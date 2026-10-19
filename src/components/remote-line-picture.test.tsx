import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { RemoteLinePicture } from './remote-line-picture'

const read = vi.hoisted(() => vi.fn())
vi.mock('@/server/dispatcher-task-context', () => ({ getDispatcherTaskContext: read }))
beforeEach(() => { read.mockReset(); read.mockResolvedValue({ tasks: [], total: 0 }) })

it('offers recovery when the publication failed, without requesting an invalid revision', async () => {
  const client = new QueryClient()
  const retry = vi.fn(), total = vi.fn()
  const row = { id: 1, projectTitle: 'P', line: 'L', joint: 'S1' } as WeldRow
  const view = (revision: number | null) => <QueryClientProvider client={client}>
    <RemoteLinePicture row={row} revision={revision} contextError="Нет связи" onTotal={total}
      onRetry={retry} onRunAction={vi.fn()} onOpenInDispatcher={vi.fn()} />
  </QueryClientProvider>
  const { rerender } = render(view(null))
  expect(screen.getByRole('alert')).toHaveTextContent('Нет связи')
  fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку задач' }))
  expect(retry).toHaveBeenCalledOnce()
  expect(read).not.toHaveBeenCalled()
  rerender(view(2))
  await waitFor(() => expect(total).toHaveBeenCalledWith(0))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(read).toHaveBeenCalledOnce()
  expect(read).toHaveBeenCalledWith({ data: { mode: 'line', rowIds: [1], computedRevision: 2, offset: 0 } })
  client.clear()
})
