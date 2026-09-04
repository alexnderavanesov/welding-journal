import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AcceptedWarningsSettingsPanel } from '@/components/accepted-warnings-settings-panel'
import { ConfirmActionProvider } from '@/lib/confirm-action-context'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  revoke: vi.fn(),
  requireDeletePassword: vi.fn(),
}))

vi.mock('@/server/dispatcher-warnings', () => ({
  listDispatcherAcceptedWarnings: mocks.list,
  revokeDispatcherAcceptedWarning: mocks.revoke,
}))

vi.mock('@/lib/security-context', () => ({
  useSecurityGuard: () => ({ requireDeletePassword: mocks.requireDeletePassword }),
}))

const warning = {
  key: 'percentage-line-control:extra-welder:project|subtitle|line|a1',
  kind: 'percentage-line-control',
  code: 'ДЗ-17',
  title: 'Лишний сварщик на процентной линии',
  context: 'Проект: Проект А · Шифр: 100 · Линия: L-10 · Клеймо: A1',
  acceptedAt: '2026-09-04T10:00:00.000Z',
}

describe('AcceptedWarningsSettingsPanel', () => {
  beforeEach(() => {
    mocks.list.mockReset().mockResolvedValue({
      items: [warning],
      total: 77,
      overallTotal: 77,
      page: 1,
      pageSize: 50,
    })
    mocks.revoke.mockReset().mockResolvedValue({ ok: true, deletedRowIds: [] })
    mocks.requireDeletePassword.mockReset().mockResolvedValue(true)
  })

  afterEach(() => cleanup())

  it('loads a bounded page and sends search, category and paging to the server', async () => {
    renderPanel()

    await screen.findByText(warning.title)
    expect(mocks.list).toHaveBeenCalledWith({
      data: {
        search: '',
        category: 'all',
        period: 'all',
        sort: 'newest',
        page: 1,
        pageSize: 50,
      },
    })
    expect(mocks.list).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск принятых исключений' }), {
      target: { value: 'L-10' },
    })
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith({
      data: expect.objectContaining({ search: 'L-10', page: 1, pageSize: 50 }),
    }))
    expect(mocks.list).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Досрочные катушки' }))
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith({
      data: expect.objectContaining({ category: 'early-coil', page: 1 }),
    }))
    expect(mocks.list).toHaveBeenCalledTimes(3)

    fireEvent.click(await screen.findByRole('button', { name: 'Следующая страница исключений' }))
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith({
      data: expect.objectContaining({ category: 'early-coil', page: 2, pageSize: 50 }),
    }))
    expect(mocks.list).toHaveBeenCalledTimes(4)
  })

  it('keeps the existing confirmation and protected cancellation flow', async () => {
    const runProtectedSettingsChange = vi.fn(async (action: () => void | Promise<void>) => {
      await action()
      return true
    })
    renderPanel(runProtectedSettingsChange)

    await screen.findByText(warning.title)
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }))
    await screen.findByRole('heading', { name: 'Отменить принятое исключение' })
    fireEvent.click(screen.getByRole('button', { name: 'Отменить исключение' }))

    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith({ data: { key: warning.key } }))
    expect(runProtectedSettingsChange).toHaveBeenCalledTimes(1)
    expect(mocks.requireDeletePassword).not.toHaveBeenCalled()
  })
})

function renderPanel(
  runProtectedSettingsChange = async (action: () => void | Promise<void>) => {
    await action()
    return true
  },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfirmActionProvider>
        <AcceptedWarningsSettingsPanel runProtectedSettingsChange={runProtectedSettingsChange} />
      </ConfirmActionProvider>
    </QueryClientProvider>,
  )
}
