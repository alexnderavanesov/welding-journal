import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useSpecialistTransferConfirmation } from './specialist-transfer-confirmation'
import { previewSpecialistTransfer } from '@/server/document-specialist-transfer-preview'

vi.mock('@/server/document-specialist-transfer-preview', () => ({ previewSpecialistTransfer: vi.fn() }))
beforeEach(() => vi.mocked(previewSpecialistTransfer).mockReset())
function Harness({ ids }: { ids: number[] }) {
  const state = useSpecialistTransferConfirmation(ids, 'primary')
  return <>{state.notice}<button disabled={!state.ready}>Сохранить</button><output>{state.confirmation ?? ''}</output></>
}
function setup(ids: number[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return render(<Harness ids={ids} />, { wrapper })
}
it('does not query KEEP; batches 1000 welds, rejects an unconfirmed conflict and resets stale confirmation', async () => {
  vi.mocked(previewSpecialistTransfer).mockResolvedValue({ conflicts: [{ title: 'ВИК-1', date: '2026-10-01' }], confirmation: 'v1' })
  const view = setup([])
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
  expect(previewSpecialistTransfer).not.toHaveBeenCalled()
  view.rerender(<Harness ids={Array.from({ length: 1000 }, (_, index) => index + 1)} />)
  const ack = await screen.findByRole('checkbox')
  expect(previewSpecialistTransfer).toHaveBeenCalledTimes(1)
  expect(vi.mocked(previewSpecialistTransfer).mock.calls[0][0].data.rowIds).toHaveLength(1000)
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  fireEvent.click(ack)
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
  vi.mocked(previewSpecialistTransfer).mockResolvedValue({ conflicts: [{ title: 'ВИК-1', date: '2026-10-01' }], confirmation: 'v2' })
  fireEvent.click(screen.getByRole('button', { name: 'Обновить проверку специалистов' }))
  await waitFor(() => expect(previewSpecialistTransfer).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked())
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  view.rerender(<Harness ids={[]} />)
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})
it('preserves non-conflicting assignments, does not refetch on focus/reconnect and blocks errors until retry', async () => {
  vi.mocked(previewSpecialistTransfer).mockRejectedValueOnce(new Error('сеть')).mockResolvedValue({ conflicts: [], confirmation: 'v1' })
  setup([1])
  await screen.findByText(/Не удалось проверить специалистов/)
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить проверку специалистов' }))
  await screen.findByText(/Конфликтов назначений нет/)
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
  fireEvent(window, new Event('focus')); fireEvent(window, new Event('online'))
  expect(previewSpecialistTransfer).toHaveBeenCalledTimes(2)
})
