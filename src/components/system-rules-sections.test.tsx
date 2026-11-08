import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SystemRulesPage } from './system-rules-page'
import { ASSIGNMENT_CALCULATIONS_HREF, CHECK_PARAMETERS_HREF, CONNECTION_RULES_HREF } from '@/lib/reference-navigation'

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

it('opens qualification parameters inside system rules and preserves an entered example across tabs', async () => {
  window.history.replaceState({}, '', CHECK_PARAMETERS_HREF)
  render(<SystemRulesPage />)
  await screen.findByRole('heading', { name: 'Как проверяется допуск клейма' })
  const tabs = screen.getByRole('tablist', { name: 'Разделы правил системы' })
  expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Соединения', 'Параметры проверки', 'Назначения и расчёты'])
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

it('opens the calculation guide directly and navigates all three tabs with the keyboard', async () => {
  window.history.replaceState({}, '', ASSIGNMENT_CALCULATIONS_HREF)
  render(<SystemRulesPage />)
  await screen.findByRole('heading', { name: 'Назначения и расчёты' })
  expect(screen.getByRole('heading', { name: '5. Добор +1 и +2 после брака' })).toBeVisible()
  expect(screen.getByRole('heading', { name: '10. Опоры Т: отдельные нормы УЗК и ПВК' })).toBeVisible()
  expect(screen.queryByRole('region', { name: 'Сравнение правил С, У и Т' })).not.toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Назначения и расчёты' }), { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: 'Соединения' })).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Соединения' }), { key: 'ArrowLeft' })
  expect(screen.getByRole('tab', { name: 'Назначения и расчёты' })).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Назначения и расчёты' }), { key: 'ArrowLeft' })
  expect(screen.getByRole('tab', { name: 'Параметры проверки' })).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Параметры проверки' }), { key: 'End' })
  expect(window.location.pathname + window.location.search).toBe(ASSIGNMENT_CALCULATIONS_HREF)
})
