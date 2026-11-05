import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getGridApi, type GridApi } from 'ag-grid-community'
import { SystemRulesPage } from './system-rules-page'
import { CONNECTION_RULES, connectionRuleSpan, type ConnectionRule } from '@/lib/connection-rules'
import { CHECK_PARAMETERS_HREF } from '@/lib/reference-navigation'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
async function grid() {
  render(<SystemRulesPage />)
  await waitFor(() => expect(getGridApi('connection-rules')).toBeDefined())
  return getGridApi('connection-rules') as GridApi<ConnectionRule>
}
function matched(api: GridApi<ConnectionRule>) {
  const rows: ConnectionRule[] = []
  api.forEachNodeAfterFilter(node => { if (!node.group && node.data) rows.push(node.data) })
  return rows
}

it('filters shared values in both original family columns, combining filters without losing the full text', async () => {
  const api = await grid()
  const row = CONNECTION_RULES.find(item => item.parameter === 'Округление количества')!
  expect(row.c).toBe(row.u)
  expect(connectionRuleSpan(row, 'c')).toBe(2)
  await act(async () => {
    await api.setColumnFilterModel('parameter', { values: [row.parameter] })
    await api.setColumnFilterModel('c', { values: [row.c] })
    await api.setColumnFilterModel('u', { values: [row.c] })
    api.onFilterChanged()
  })
  expect(matched(api)).toEqual([row])
  expect(screen.getByText(`Найдено 1 из ${CONNECTION_RULES.length}`)).toBeVisible()
  await act(async () => {
    await api.setColumnFilterModel('t', { values: [row.c] })
    api.onFilterChanged()
  })
  expect(matched(api)).toEqual([])
  expect(screen.getByRole('heading', { name: 'Примечания' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }))
  await waitFor(() => expect(matched(api)).toHaveLength(CONNECTION_RULES.length))
})

it('searches every group, retains notes for zero matches and restores the whole comparison', async () => {
  const api = await grid()
  fireEvent.change(screen.getByRole('textbox', { name: 'Поиск правил соединений' }), { target: { value: 'годен' } })
  await waitFor(() => expect(matched(api).length).toBeGreaterThan(0))
  await waitFor(() => expect(matched(api).length).toBeLessThan(CONNECTION_RULES.length))
  fireEvent.change(screen.getByRole('textbox', { name: 'Поиск правил соединений' }), { target: { value: 'нет-такого-правила-123' } })
  await waitFor(() => expect(matched(api)).toEqual([]))
  expect(screen.getByRole('heading', { name: 'Примечания' })).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Параметры проверки' })).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Параметры проверки' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск правил' }))
  await waitFor(() => expect(matched(api)).toHaveLength(CONNECTION_RULES.length))
})

it('retains all four columns, exact rule links and safe merging boundaries', async () => {
  const api = await grid()
  // jsdom has no viewport geometry; autoHeight keeps the filtered row mounted.
  // Browser checks separately cover scrolling/virtualization and column resizing.
  act(() => api.setGridOption('domLayout', 'autoHeight'))
  const columns = api.getColumnDefs()!
  expect(columns.filter(column => !('hide' in column && column.hide))).toHaveLength(4)
  const links = CONNECTION_RULES.filter(row => row.checkParametersLink)
  expect(links).toHaveLength(1)
  await act(async () => {
    await api.setColumnFilterModel('parameter', { values: [links[0].parameter] })
    api.onFilterChanged()
  })
  await waitFor(() => {
    const renderedLinks = screen.getAllByRole('link', { name: 'Параметры проверки' })
    expect(renderedLinks.length).toBeGreaterThan(0)
    for (const link of renderedLinks) expect(link).toHaveAttribute('href', CHECK_PARAMETERS_HREF)
  })
  const same = { ...links[0], c: 'Правило', u: 'Правило', t: 'Правило' }
  expect(connectionRuleSpan(same, 'c', false)).toBe(3)
  expect(connectionRuleSpan({ ...same, c: 'Другое' }, 'u', false)).toBe(2)
  expect(connectionRuleSpan({ ...same, u: 'Другое' }, 'c', false)).toBe(1)
  expect(connectionRuleSpan(same, 'c', true)).toBe(2)
  expect(connectionRuleSpan(undefined, 'c')).toBe(1)
  const differentSupport = { ...same, t: 'Отдельное правило опор' }
  expect(connectionRuleSpan(differentSupport, 'c', false, ['parameter', 'c', 't'])).toBe(1)
  expect(connectionRuleSpan(differentSupport, 'c', false, ['c'])).toBe(1)
  expect(connectionRuleSpan(same, 'c', false, ['c', 't'])).toBe(2)
  expect(connectionRuleSpan(same, 'u', false, ['u', 'parameter', 't'])).toBe(1)
})
