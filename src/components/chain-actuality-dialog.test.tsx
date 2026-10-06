import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChainActualityDialog } from './chain-actuality-dialog'

const mocks = vi.hoisted(() => ({ preview: vi.fn(), save: vi.fn(), password: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/server/chain-actuality', () => ({ previewChainActuality: mocks.preview, setChainActuality: mocks.save }))
vi.mock('@/lib/security-context', () => ({ useSecurityGuard: () => ({ requireEditPassword: mocks.password }) }))
vi.mock('@/lib/weld-query-utils', () => ({ scheduleWeldDataRefresh: mocks.invalidate }))
const preview = { rowId: 1, active: false, token: 'a'.repeat(64), reason: null, total: 2, changedCount: 1, page: 0, pageSize: 100,
  rows: [{ id: 1, joint: 'S1', officiality: 'неофициальный', inactive: false }, { id: 2, joint: 'S1R1', officiality: '', inactive: true }] }
function mount(active = false) {
  const props = { rowId: 1, active, onClose: vi.fn(), onSaved: vi.fn() }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ChainActualityDialog {...props} /></QueryClientProvider>)
  return props
}
beforeEach(() => { vi.clearAllMocks(); mocks.preview.mockResolvedValue(preview); mocks.save.mockResolvedValue({ changedCount: 1 }); mocks.password.mockResolvedValue(true) })
describe('confirmed reversible chain actuality', () => {
  it('explains a single inactive joint without repair/coil terminology', async () => {
    mocks.preview.mockResolvedValue({ ...preview, active: true, total: 1, rows: [preview.rows[1]] })
    mount(true)
    await screen.findByRole('heading', { name: 'Вернуть актуальность стыку' })
    expect(screen.getByText('Стык снова станет актуальным по ИЗМу. Документы, результаты НК, назначения, официальность и факт выреза сохранятся.')).toBeInTheDocument()
    expect(screen.queryByText(/R\/W|сторона катушки|Записей в цепочке/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить актуальность стыка' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
  })

  it.each(['cancel', 'escape'])('one preview, no focus/reconnect fetches, %s makes no changes', async mode => {
    const props = mount()
    await screen.findByText('S1R1 / 2')
    fireEvent.focus(window); window.dispatchEvent(new Event('online'))
    expect(mocks.preview).toHaveBeenCalledOnce()
    if (mode === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    else fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled()
  })
  it('requires confirmation and coalesces duplicate clicks', async () => {
    const props = mount()
    await screen.findByText('S1R1 / 2')
    expect(screen.getByText(/Каждая сторона катушки — отдельное соединение со своей историей/)).toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Подтвердить актуальность цепочки' })
    expect(save).toBeDisabled(); fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(save); fireEvent.click(save)
    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce())
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ data: { rowId: 1, active: false, token: preview.token, confirmed: true } })
    expect(mocks.invalidate).toHaveBeenCalledOnce()
  })
  it('leaves stale previews open, clears confirmation and supports a fresh check', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Цепочка изменилась'))
    const props = mount()
    await screen.findByText('S1R1 / 2')
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Подтвердить актуальность цепочки' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Цепочка изменилась')
    expect(screen.getByRole('checkbox')).not.toBeChecked(); expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить проверку' }))
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(2))
    expect(mocks.save).toHaveBeenCalledOnce()
  })
  it.each([{ reason: 'Исправьте связи' }, { changedCount: 0 }])('does not offer confirmation for blocked/no-op states %s', async values => {
    mocks.preview.mockResolvedValue({ ...preview, ...values }); mount()
    await screen.findByText('S1R1 / 2')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Подтвердить актуальность цепочки' })).toBeDisabled()
  })
  it('uses the server page after the group shrinks and clears confirmation on navigation', async () => {
    mocks.preview.mockResolvedValueOnce({ ...preview, total: 301, page: 0 })
      .mockResolvedValueOnce({ ...preview, total: 301, page: 1 })
      .mockResolvedValueOnce({ ...preview, total: 301, page: 2 })
      .mockResolvedValueOnce({ ...preview, total: 150, page: 1 })
    mount()
    await screen.findByText('Страница 1 из 4')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Следующие записи' }))
    await screen.findByText('Страница 2 из 4')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Следующие записи' }))
    await screen.findByText('Страница 3 из 4')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить проверку' }))
    await screen.findByText('Страница 2 из 2')
    expect(screen.getByRole('button', { name: 'Следующие записи' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Предыдущие записи' })).toBeEnabled()
    expect(mocks.preview).toHaveBeenCalledTimes(4)
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
