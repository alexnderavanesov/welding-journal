import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AccountListUser } from '@/lib/account-user-labels'
import { UsersPanel } from './account-users-panel'

const mocks = vi.hoisted(() => ({ listAccounts: vi.fn(), inviteAccount: vi.fn(), changeAccount: vi.fn(), sendManagedLink: vi.fn(), deleteAccount: vi.fn() }))
vi.mock('@/server/account-api', () => mocks)
vi.mock('@/lib/security-context', () => ({ useAccess: () => ({ identity: { id: 'owner', role: 'owner' } }) }))
vi.mock('./permission-editor', () => ({ PermissionEditor: () => null }))
vi.mock('./account-users-grid', () => ({ default: ({ users, renderActions }: { users: AccountListUser[]; renderActions: (user: AccountListUser) => ReactNode }) =>
  <div>{users.map(user => <div key={user.id}>{user.name}{renderActions(user)}</div>)}</div> }))

const user: AccountListUser = { id: 'reader', name: 'Читатель', email: 'reader@example.test', title: '', role: 'user', status: 'pending',
  permissions: ['welding.view'], revision: 1, linkExpiresAt: null, lastActiveAt: null, online: false }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><UsersPanel /></QueryClientProvider>)
}
async function submitInvitation() {
  fireEvent.click(screen.getByRole('button', { name: 'Пригласить пользователя' }))
  fireEvent.change(screen.getByLabelText('Фамилия и имя'), { target: { value: 'Новый сотрудник' } })
  fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'new@example.test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Создать и отправить приглашение' }))
}
beforeEach(() => { vi.resetAllMocks(); mocks.listAccounts.mockResolvedValue([user]) })

it.each([
  { result: { sent: true }, message: 'Письмо подготовлено и передано отправителю.' },
  { result: { sent: false, message: 'Аккаунт сохранён, но письмо не доставлено.' }, message: 'Аккаунт сохранён, но письмо не доставлено.' },
])('does not flash an error after a saved invitation while the list refreshes: $result.sent', async ({ result, message }) => {
  const refresh = deferred<AccountListUser[]>()
  mocks.listAccounts.mockResolvedValueOnce([user]).mockReturnValueOnce(refresh.promise)
  mocks.inviteAccount.mockResolvedValue(result)
  mount()
  await screen.findByText('Читатель')
  await submitInvitation()
  await waitFor(() => expect(mocks.listAccounts).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(message)
  expect(screen.getByRole('button', { name: 'Пригласить пользователя' })).toBeDisabled()
  await act(async () => { refresh.resolve([user]) })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Пригласить пользователя' })).toBeEnabled())
  expect(mocks.inviteAccount).toHaveBeenCalledOnce()
})

it('keeps real invitation errors and the entered values in the dialog for correction', async () => {
  mocks.inviteAccount.mockRejectedValue(new Error('Этот адрес уже используется.'))
  mount()
  await screen.findByText('Читатель')
  await submitInvitation()
  expect(await screen.findByRole('alert')).toHaveTextContent('Этот адрес уже используется.')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByLabelText('Почта')).toHaveValue('new@example.test')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Создать и отправить приглашение' })).toBeEnabled())
})

it('closes the saved permissions draft before its new revision arrives', async () => {
  const refresh = deferred<AccountListUser[]>()
  mocks.listAccounts.mockResolvedValueOnce([user]).mockReturnValueOnce(refresh.promise)
  mocks.changeAccount.mockResolvedValue({ ok: true })
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Настроить права' }))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить права' }))
  await waitFor(() => expect(mocks.listAccounts).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Сохранено.')
  await act(async () => { refresh.resolve([{ ...user, revision: 2 }]) })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
