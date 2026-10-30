import { act, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AccessIdentity } from './access-permissions'

const state = vi.hoisted(() => ({ fetch: vi.fn(), clear: vi.fn(), refresh: undefined as undefined | (() => Promise<void>) }))
vi.unmock('@/lib/security-context')
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => state }))
vi.mock('@tanstack/react-router', () => ({ useRouterState: () => '/lnk' }))
vi.mock('@/server/account-api', () => ({ getCurrentAccount: state.fetch, refreshAccountActivity: state.fetch }))
vi.mock('./account-activity', () => ({ watchAccountActivity: (refresh: () => Promise<void>) => { state.refresh = refresh; void refresh(); return () => {} } }))
import { SecurityProvider, SiteSecurityGate, useAccess } from './security-context'

const identity: AccessIdentity = { id: 'user', name: 'Сотрудник', email: 'user@test.example', title: '', role: 'user', revision: 1, permissions: ['lnk.view'] }
beforeEach(() => { state.fetch.mockReset(); state.clear.mockReset(); state.fetch.mockImplementation(async () => structuredClone(identity)) })

it('preserves the identity reference and private view on an unchanged server refresh', async () => {
  const identities: Array<AccessIdentity | null> = []
  function Probe() { const access = useAccess(); identities.push(access.identity); return <span>Открытый фильтр</span> }
  render(<SecurityProvider><SiteSecurityGate><Probe /></SiteSecurityGate></SecurityProvider>)
  await screen.findByText('Открытый фильтр')
  const original = identities.at(-1), cleared = state.clear.mock.calls.length
  await act(async () => { await state.refresh!() })
  expect(identities.every(value => value === original)).toBe(true)
  expect(state.clear).toHaveBeenCalledTimes(cleared)
  expect(screen.getByText('Открытый фильтр')).toBeVisible()
})

it('applies changed profile fields and revoked rights instead of retaining a stale identity', async () => {
  function Probe() { return <span>{useAccess().identity?.name}</span> }
  render(<SecurityProvider><SiteSecurityGate><Probe /></SiteSecurityGate></SecurityProvider>)
  await screen.findByText('Сотрудник')
  state.fetch.mockResolvedValue({ ...identity, name: 'Новое имя' })
  await act(async () => { await state.refresh!() })
  expect(screen.getByText('Новое имя')).toBeVisible()
  state.fetch.mockResolvedValue({ ...identity, revision: 2, permissions: [] })
  await act(async () => { await state.refresh!() })
  expect(screen.queryByText('Новое имя')).not.toBeInTheDocument()
  expect(screen.getByText('Доступ к этому разделу не предоставлен.')).toBeVisible()
  expect(state.clear).toHaveBeenCalledTimes(2)
})

it('does not restore an old identity from a delayed response after access is revoked', async () => {
  render(<SecurityProvider><SiteSecurityGate><span>Рабочие данные</span></SiteSecurityGate></SecurityProvider>)
  await screen.findByText('Рабочие данные')
  let release!: (value: AccessIdentity) => void
  state.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const stale = state.refresh!()
  state.fetch.mockResolvedValue(null)
  await act(async () => { await state.refresh!() })
  await act(async () => { release(identity); await stale })
  expect(screen.queryByText('Рабочие данные')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Вход в систему' })).toBeVisible()
})
