import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AccessIdentity } from '@/lib/access-permissions'

const mocks = vi.hoisted(() => ({ identity: null as AccessIdentity | null, fetch: vi.fn(), updateOwnProfile: vi.fn(), invalidate: vi.fn(), clear: vi.fn(), refresh: undefined as undefined | (() => Promise<void>) }))
vi.unmock('@/lib/security-context')
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate, clear: mocks.clear }) }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn(), useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) => select({ location: { pathname: '/account' } }) }))
vi.mock('@/lib/account-activity', () => ({ watchAccountActivity: (refresh: () => Promise<void>) => { mocks.refresh = refresh; void refresh(); return () => {} } }))
vi.mock('./app-sidebar', () => ({ AppSidebar: () => null }))
vi.mock('./account-users-panel', () => ({ UsersPanel: () => null, accountRoleLabel: () => 'Администратор' }))
vi.mock('@/server/account-api', () => ({ getCurrentAccount: mocks.fetch, refreshAccountActivity: mocks.fetch, updateOwnProfile: mocks.updateOwnProfile }))
import { SecurityProvider } from '@/lib/security-context'
import { AccountPage } from './account-page'

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  mocks.identity = { id: 'admin', name: 'Первое имя', title: 'Инженер', email: 'admin@e2e.test', role: 'admin', permissions: [], revision: 1 }
  mocks.fetch.mockImplementation(async () => structuredClone(mocks.identity))
  mocks.updateOwnProfile.mockResolvedValue({ ok: true })
  mocks.invalidate.mockResolvedValue(undefined)
  window.history.replaceState({}, '', '/account?tab=profile')
})
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); vi.unstubAllGlobals() })

async function openProfile() {
  render(<SecurityProvider><AccountPage /></SecurityProvider>)
  await screen.findByLabelText('Фамилия и имя')
}

it('preserves the draft when the real access gate refreshes an unchanged identity', async () => {
  await openProfile()
  fireEvent.change(screen.getByLabelText('Фамилия и имя'), { target: { value: 'Мой черновик' } })
  const clears = mocks.clear.mock.calls.length
  await act(async () => { await mocks.refresh!() })
  expect(screen.getByLabelText('Фамилия и имя')).toHaveValue('Мой черновик')
  expect(mocks.clear).toHaveBeenCalledTimes(clears)
  expect(mocks.updateOwnProfile).not.toHaveBeenCalled()
})

it('does not combine an old draft with a new revision when the real access gate changes identity', async () => {
  await openProfile()
  fireEvent.change(screen.getByLabelText('Фамилия и имя'), { target: { value: 'Мой черновик' } })
  mocks.identity = { ...mocks.identity!, name: 'Актуальное имя', title: 'Руководитель', revision: 2 }
  await act(async () => { await mocks.refresh!() })
  expect(screen.getByLabelText('Фамилия и имя')).toHaveValue('Актуальное имя')
  expect(screen.getByLabelText('Должность')).toHaveValue('Руководитель')
  expect(mocks.updateOwnProfile).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Фамилия и имя'), { target: { value: 'Повторное исправление' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }))
  await waitFor(() => expect(mocks.updateOwnProfile).toHaveBeenCalledWith({ data: { name: 'Повторное исправление', title: 'Руководитель', revision: 2 } }))
  await screen.findByText('Сохранено.')
})

it('submits the old version and retains the draft on a conflict before access refresh', async () => {
  await openProfile()
  fireEvent.change(screen.getByLabelText('Фамилия и имя'), { target: { value: 'Мой черновик' } })
  mocks.identity = { ...mocks.identity!, title: 'Руководитель', revision: 2 }
  mocks.updateOwnProfile.mockRejectedValueOnce(new Error('Профиль уже изменён. Обновите его и повторите.'))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }))
  await screen.findByText('Профиль уже изменён. Обновите его и повторите.')
  expect(mocks.updateOwnProfile).toHaveBeenCalledWith({ data: { name: 'Мой черновик', title: 'Инженер', revision: 1 } })
  expect(screen.getByLabelText('Фамилия и имя')).toHaveValue('Мой черновик')
  await act(async () => { await mocks.refresh!() })
  expect(screen.getByLabelText('Должность')).toHaveValue('Руководитель')
  expect(mocks.updateOwnProfile).toHaveBeenCalledTimes(1)
})
