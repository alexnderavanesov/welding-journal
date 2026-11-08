import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChainActualityDialog } from './chain-actuality-dialog'

const mocks = vi.hoisted(() => ({ preview: vi.fn() }))
vi.mock('@/server/chain-actuality', () => ({ previewChainActuality: mocks.preview }))
const preview = { rowId: 1, active: false, token: 'a'.repeat(64), reason: null, total: 2, changedCount: 1, page: 0, pageSize: 100, requestRemovals: [], pendingRequestCount: 0,
  rows: [{ id: 1, joint: 'S1', officiality: 'неофициальный', inactive: false }, { id: 2, joint: 'S1R1', officiality: '', inactive: true }] }
function mount(active = false) {
  const props = { rowId: 1, active, onClose: vi.fn(), onConfirm: vi.fn() }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ChainActualityDialog {...props} /></QueryClientProvider>)
  return props
}
beforeEach(() => { vi.clearAllMocks(); mocks.preview.mockResolvedValue(preview) })
describe('card-only chain actuality confirmation', () => {
  it('warns about request positions and empty documents before changing the draft', async () => {
    mocks.preview.mockResolvedValue({ ...preview, pendingRequestCount: 2, requestRemovals: [
      { documentId: 10, title: 'A1', date: '2026-11-06', positions: ['S1 · УЗК'], remaining: 1 },
      { documentId: 11, title: 'A2', date: '', positions: ['S1R1 · ПСТО'], remaining: 0 },
    ] })
    const props = mount()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Из заявок будут удалены позиции без результата: 2')
    expect(alert).toHaveTextContent('S1 · УЗК')
    expect(alert).toHaveTextContent('Останется позиций: 1')
    expect(alert).toHaveTextContent('Заявка станет пустой и будет удалена')
    expect(screen.getByRole('button', { name: 'Подтвердить актуальность цепочки' })).toBeDisabled()
    expect(screen.getByText(/Изменение применится при сохранении карточки/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить актуальность цепочки' }))
    expect(props.onConfirm).toHaveBeenCalledExactlyOnceWith({ active: false, token: preview.token, confirmed: true })
  })
  it.each(['cancel', 'escape'])('one preview, no focus/reconnect fetches; %s leaves the draft unchanged', async mode => {
    const props = mount()
    await screen.findByText('S1R1 / 2')
    fireEvent.focus(window); window.dispatchEvent(new Event('online'))
    expect(mocks.preview).toHaveBeenCalledOnce()
    if (mode === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    else fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledOnce(); expect(props.onConfirm).not.toHaveBeenCalled()
  })
  it('keeps an explicit removal warning when document details are hidden by access rights', async () => {
    mocks.preview.mockResolvedValue({ ...preview, pendingRequestCount: 2, hiddenRemovalCount: 1 })
    const props = mount()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('сведения о которых недоступны по вашим правам')
    expect(alert).toHaveTextContent('пустые заявки будут удалены')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить актуальность цепочки' }))
    expect(props.onConfirm).toHaveBeenCalledWith({ active: false, token: preview.token, confirmed: true })
  })
  it('lets the card return to its stored state after a confirmed but unsaved change', async () => {
    mocks.preview.mockResolvedValue({ ...preview, active: true, changedCount: 0 })
    const props = mount(true)
    await screen.findByText('Снятые ранее позиции заявок автоматически не восстанавливаются.')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить актуальность цепочки' }))
    expect(props.onConfirm).toHaveBeenCalledWith({ active: true, token: preview.token, confirmed: true })
  })
  it('requires a new confirmation after a manual recheck', async () => {
    mount()
    await screen.findByText('S1R1 / 2')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Повторить проверку' }))
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })
})
