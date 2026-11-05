import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { CHECK_PARAMETERS_HREF, CONNECTION_RULES_HREF } from '@/lib/reference-navigation'

const users = vi.hoisted(() => vi.fn())
vi.mock('@/lib/security-context', () => ({
  SiteSecurityGate: ({ children }: { children: ReactNode }) => children,
  useAccess: () => ({ identity: { id: 'reader', name: 'Читатель', title: '', email: 'reader@local.invalid', role: 'user', revision: 1 }, refresh: vi.fn(), can: () => false }),
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn(), clear: vi.fn() }) }))
vi.mock('./app-sidebar', () => ({ AppSidebar: () => null }))
vi.mock('./account-users-panel', () => ({ UsersPanel: users, accountRoleLabel: () => 'Пользователь' }))
vi.mock('./system-rules-page', () => ({ SystemRulesPage: () => <p>Таблица соединений</p> }))
vi.mock('./user-guide-page', () => ({ UserGuidePage: () => <p>Текст руководства</p> }))
vi.mock('@/server/account-api', () => ({}))
import { AccountPage } from './account-page'
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); vi.clearAllMocks() })

it('opens rules directly for a regular user and places them immediately before the guide', async () => {
  window.history.replaceState({}, '', CHECK_PARAMETERS_HREF)
  render(<AccountPage />)
  await screen.findByText('Таблица соединений')
  expect(within(screen.getByRole('tablist', { name: 'Аккаунт и доступ' })).getAllByRole('tab').map(tab => tab.textContent))
    .toEqual(['Мой профиль', 'Правила системы', 'Руководство'])
  expect(screen.getByRole('tab', { name: 'Правила системы' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(screen.getByRole('tab', { name: 'Правила системы' }))
  expect(window.location.pathname + window.location.search).toBe(CHECK_PARAMETERS_HREF)
  expect(users).not.toHaveBeenCalled()
})

it('updates the exact URL and restores the selected tab on browser navigation', async () => {
  window.history.replaceState({}, '', '/account?tab=profile')
  render(<AccountPage />)
  fireEvent.click(screen.getByRole('tab', { name: 'Правила системы' }))
  await screen.findByText('Таблица соединений')
  expect(window.location.pathname + window.location.search).toBe(CONNECTION_RULES_HREF)
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Правила системы' }), { key: 'ArrowRight' })
  await screen.findByText('Текст руководства')
  expect(window.location.search).toBe('?tab=guide')
  window.history.replaceState({}, '', CONNECTION_RULES_HREF)
  fireEvent.popState(window)
  expect(screen.getByRole('tab', { name: 'Правила системы' })).toHaveAttribute('aria-selected', 'true')
  expect(await screen.findByText('Таблица соединений')).toBeVisible()
})
