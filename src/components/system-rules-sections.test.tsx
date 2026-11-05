import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SystemRulesPage } from './system-rules-page'
import { CHECK_PARAMETERS_HREF, CONNECTION_RULES_HREF } from '@/lib/reference-navigation'

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

it('opens qualification parameters inside system rules and preserves an entered example across tabs', async () => {
  window.history.replaceState({}, '', CHECK_PARAMETERS_HREF)
  render(<SystemRulesPage />)
  await screen.findByRole('heading', { name: 'Как проверяется допуск клейма' })
  const tabs = screen.getByRole('tablist', { name: 'Разделы правил системы' })
  expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Соединения', 'Параметры проверки'])
  expect(screen.queryByText(/Сравнение стыковых, угловых соединений/)).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Параметры проверки' })).not.toBeInTheDocument()
  const details = screen.getByText('Разобрать свой пример').closest('details')!
  fireEvent.click(details.querySelector('summary')!)
  fireEvent.change(screen.getByLabelText('Диаметр D1, мм'), { target: { value: '57' } })
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Параметры проверки' }), { key: 'Home' })
  expect(window.location.pathname + window.location.search).toBe(CONNECTION_RULES_HREF)
  expect(screen.getByRole('tab', { name: 'Соединения' })).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Соединения' }), { key: 'ArrowRight' })
  expect(window.location.pathname + window.location.search).toBe(CHECK_PARAMETERS_HREF)
  expect(screen.getByLabelText('Диаметр D1, мм')).toHaveValue('57')
  window.history.replaceState({}, '', CONNECTION_RULES_HREF)
  fireEvent.popState(window)
  expect(screen.getByRole('tab', { name: 'Соединения' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByText(/Сравнение стыковых, угловых соединений/)).not.toBeInTheDocument()
})
