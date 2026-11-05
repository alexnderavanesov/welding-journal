import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '@/components/settings-page'
import { ConfirmActionProvider } from '@/lib/confirm-action-context'

const mocks = vi.hoisted(() => ({ usage: vi.fn(), settingsPassword: vi.fn(), exceptions: vi.fn() }))
vi.mock('@/server/dispatcher-warnings', () => ({ listDispatcherAcceptedWarnings: mocks.exceptions, revokeDispatcherAcceptedWarning: vi.fn() }))
vi.mock('@/server/weld-read-api', () => ({ getWeldDataUsageSummary: mocks.usage }))
vi.mock('@/lib/security-context', () => ({ useAccess: () => ({ can: () => true }),
  useSecurityGuard: () => ({ requireSettingsChangePassword: mocks.settingsPassword }),
}))

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ConfirmActionProvider><SettingsPage /></ConfirmActionProvider></QueryClientProvider>)
  return client
}

describe('settings system rule catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.exceptions.mockResolvedValue({ items: [], total: 0, overallTotal: 0, page: 1, pageSize: 25 })
    localStorage.clear()
    window.history.replaceState(null, '', '/settings#system-rule-sp-05')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true })
  })

  afterEach(() => {
    cleanup()
    window.history.replaceState(null, '', '/')
    vi.restoreAllMocks()
  })

  it('opens the renamed inch calculation tab without changing settings or requesting data', () => {
    localStorage.setItem('welding-other-settings', JSON.stringify({ wdiCalculationMode: 'formula' }))
    const savedSettings = localStorage.getItem('welding-other-settings')
    mount()
    expect(screen.queryByRole('button', { name: 'Прочее' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Расчет дюймов' }))
    expect(screen.getByRole('heading', { name: 'Расчет дюймов' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Расчет WDI' })).toBeVisible()
    expect(localStorage.getItem('welding-other-settings')).toBe(savedSettings)
    expect(mocks.usage).not.toHaveBeenCalled()
    expect(mocks.settingsPassword).not.toHaveBeenCalled()
  })

  it('keeps the optional DLS requirement accessible without disabling mandatory qualifications', async () => {
    mocks.settingsPassword.mockResolvedValue(true)
    window.history.replaceState(null, '', '/settings#rules-dls-requirement')
    mount()
    const toggle = screen.getByRole('checkbox', { name: 'Требовать ДЛС для официальных клейм' })
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
    let stored = JSON.parse(localStorage.getItem('welding-save-check-settings')!)
    expect(stored).toMatchObject({ officialDls: true, officialRegistry: true, officialMaterialGroup: true })
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).not.toBeChecked())
    stored = JSON.parse(localStorage.getItem('welding-save-check-settings')!)
    expect(stored).toMatchObject({ officialDls: false, officialRegistry: true, officialNaksDate: true })
    expect(mocks.settingsPassword).not.toHaveBeenCalled() // Personal checks.edit is checked directly for this independent subsection.
    expect(mocks.usage).not.toHaveBeenCalled()
  })

  it('shows removable connection types without system badges and loads data usage only once', async () => {
    mocks.usage.mockResolvedValue({ rowsCount: 0, leadingLetterIndexedRowsCount: 0, weldingTypes: [], connectionTypes: [], materialGroups: [], testTypes: [] })
    localStorage.setItem('welding-data-list-settings', JSON.stringify({ weldingTypes: [], connectionTypes: [], materialGroups: [], testTypes: [] }))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Данные' }))
    await waitFor(() => expect(mocks.usage).toHaveBeenCalledOnce())
    await screen.findByRole('region', { name: 'Способ сварки' })
    for (const value of ['РАД', 'РД', 'М01', 'М05', 'М11']) {
      expect(screen.getByText(value)).toBeVisible()
      expect(screen.queryByRole('button', { name: `Удалить ${value}` })).not.toBeInTheDocument()
    }
    for (const value of ['С17', 'У19', 'Т', 'Т1', 'Т3', 'Т4Д']) expect(screen.getByRole('button', { name: `Удалить ${value}` })).toBeVisible()
    expect(screen.queryByText('Системное')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Очистить список|Вернуть РД|Вернуть ГИ/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Добавить' })).toHaveLength(4)
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); onlineManager.setOnline(false); onlineManager.setOnline(true) })
    expect(mocks.usage).toHaveBeenCalledOnce()
    expect(mocks.settingsPassword).not.toHaveBeenCalled()
  })

  it('removes unused S/U/T types but preserves the specific used type, including normalized legacy usage', async () => {
    mocks.usage.mockResolvedValue({ rowsCount: 3, leadingLetterIndexedRowsCount: 0, weldingTypes: [], connectionTypes: [[' т1 ', 1], ['С17', 1], ['У19', 1]], materialGroups: [], testTypes: [] })
    mocks.settingsPassword.mockResolvedValue(true)
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Данные' }))
    await waitFor(() => expect(screen.getAllByText('стыков: 1')).toHaveLength(3))
    for (const value of ['Т1', 'С17', 'У19']) {
      fireEvent.click(screen.getByRole('button', { name: `Удалить ${value}` }))
      expect(screen.getByText(new RegExp(`Нельзя удалить ${value}:`))).toBeVisible()
    }
    expect(mocks.settingsPassword).not.toHaveBeenCalled()
    for (const value of ['Т', 'Т3', 'Т4Д']) {
      fireEvent.click(screen.getByRole('button', { name: `Удалить ${value}` }))
      await waitFor(() => expect(screen.queryByRole('button', { name: `Удалить ${value}` })).not.toBeInTheDocument())
    }
    expect(JSON.parse(localStorage.getItem('welding-data-list-settings')!).connectionTypes).toEqual(['С17', 'У19', 'Т1'])
  })

  it('adds and removes only custom values, preserves used values and does not duplicate fixed codes', async () => {
    mocks.usage.mockResolvedValue({ rowsCount: 1, leadingLetterIndexedRowsCount: 1, weldingTypes: [['МП', 1]], connectionTypes: [], materialGroups: [], testTypes: [] })
    mocks.settingsPassword.mockResolvedValue(true)
    localStorage.setItem('welding-data-list-settings', JSON.stringify({ weldingTypes: ['МП'], connectionTypes: [], materialGroups: [], testTypes: ['ГИ', 'ПИ'] }))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Данные' }))
    await screen.findByText('стыков: 1')
    fireEvent.click(screen.getByRole('button', { name: 'Удалить МП' }))
    expect(screen.getByText(/Нельзя удалить МП/)).toBeVisible()
    expect(mocks.settingsPassword).not.toHaveBeenCalled()
    const material = within(screen.getByRole('region', { name: 'Группа материалов' }))
    fireEvent.change(material.getByLabelText('Новое значение'), { target: { value: ' м01 ' } })
    fireEvent.click(material.getByRole('button', { name: 'Добавить' }))
    expect(screen.getByText('Значение М01 уже есть в списке.')).toBeVisible()
    expect(mocks.settingsPassword).not.toHaveBeenCalled()
    fireEvent.change(material.getByLabelText('Новое значение'), { target: { value: 'М02' } })
    fireEvent.keyDown(material.getByLabelText('Новое значение'), { key: 'Enter' })
    await material.findByRole('button', { name: 'Удалить М02' })
    fireEvent.click(material.getByRole('button', { name: 'Удалить М02' }))
    await waitFor(() => expect(material.queryByRole('button', { name: 'Удалить М02' })).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Удалить ГИ' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Удалить ГИ' })).not.toBeInTheDocument())
    expect(material.getByText('М01')).toBeVisible()
    expect(mocks.settingsPassword).toHaveBeenCalledTimes(3)
  })

  it('explains and blocks unsupported classes and material prefixes before any save', async () => {
    mocks.usage.mockResolvedValue({ rowsCount: 0, leadingLetterIndexedRowsCount: 0, weldingTypes: [], connectionTypes: [], materialGroups: [], testTypes: [] })
    mocks.settingsPassword.mockResolvedValue(true)
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Данные' }))
    const connections = within(await screen.findByRole('region', { name: 'Тип соединения' }))
    expect(connections.getByText(/Первая буква — кириллическая «С», «У» или «Т»/)).toBeVisible()
    const materials = within(screen.getByRole('region', { name: 'Группа материалов' }))
    expect(materials.getByText(/Первая буква — только кириллическая «М»/)).toBeVisible()
    for (const [section, value] of [[connections, 'Н1'], [connections, 'C2'], [materials, 'Н01'], [materials, 'M02']] as const) {
      const input = section.getByLabelText('Новое значение')
      fireEvent.change(input, { target: { value } })
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(section.getByRole('button', { name: 'Добавить' })).toBeDisabled()
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(section.queryByRole('button', { name: `Удалить ${value}` })).not.toBeInTheDocument()
    }
    expect(mocks.settingsPassword).not.toHaveBeenCalled()
    fireEvent.change(connections.getByLabelText('Новое значение'), { target: { value: ' с2 ' } })
    fireEvent.keyDown(connections.getByLabelText('Новое значение'), { key: 'Enter' })
    await connections.findByRole('button', { name: 'Удалить С2' })
  })

  it('opens mandatory rules including support structure and seven optional guards/reminders without data requests', async () => {
    const client = mount()
    const rules = screen.getAllByRole('article')
    expect(rules).toHaveLength(12)
    expect(screen.getByRole('heading', { name: 'СП-07 · Допустимые результаты ЛНК' })).toBeVisible()
    for (const rule of rules) expect(within(rule).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(5)
    expect(screen.getByRole('tab', { name: 'Принятые исключения' })).toBeVisible()
    expect(document.querySelectorAll('[id^="save-check-setting-"] input[type="checkbox"]')).toHaveLength(0)
    fireEvent.click(screen.getByRole('tab', { name: 'Защиты ввода' }))
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).getAllByRole('checkbox')).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: 'Задачи диспетчера' }))
    expect(document.querySelectorAll('[id^="dispatcher-setting-"] input[type="checkbox"]')).toHaveLength(6)
    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      onlineManager.setOnline(false)
      onlineManager.setOnline(true)
    })
    expect(mocks.usage).not.toHaveBeenCalled()
    expect(mocks.settingsPassword).not.toHaveBeenCalled()
    expect(mocks.exceptions).not.toHaveBeenCalled()
    expect(client.isFetching()).toBe(0)
  })

  it.each(['ЗВ20', 'ЗВ-20', 'ДЗ17', 'ДЗ-17', 'СП07', 'СП-07', 'Правила ремонта'])(
    'finds SP-07 from %s and opens the rule', (query) => {
      mount()
      fireEvent.click(screen.getByRole('tab', { name: 'Задачи диспетчера' }))
      fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по настройкам' }), { target: { value: query } })
      fireEvent.click(screen.getAllByRole('button', { name: /СП-07 · Допустимые результаты ЛНК/ })[0])
      expect(screen.getByRole('searchbox', { name: 'Поиск по настройкам' })).toHaveValue('')
      expect(screen.getByRole('heading', { name: 'СП-07 · Допустимые результаты ЛНК' })).toBeVisible()
      expect(mocks.usage).not.toHaveBeenCalled()
    },
  )

  it('redirects a legacy anchor and removes all mandatory policy toggles', () => {
    window.history.replaceState(null, '', '/settings#save-check-setting-lnkResultRepairRules')
    localStorage.setItem('welding-save-check-settings', JSON.stringify({ lnkResultRepairRules: false }))
    mount()
    expect(screen.getByRole('heading', { name: 'СП-07 · Допустимые результаты ЛНК' })).toBeVisible()
    expect(screen.queryByRole('checkbox', { name: /Правила ремонта/ })).not.toBeInTheDocument()
    expect(document.getElementById('save-check-setting-lnkResultRepairRules')).toBeNull()
    expect(document.getElementById('save-check-setting-dateFormat')).toBeNull()
    act(() => {
      window.location.hash = '#dispatcher-setting-check-repair-diameter'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(screen.getByRole('heading', { name: 'СП-07 · Допустимые результаты ЛНК' })).toBeVisible()
  })

  it('loads the exception registry only on its tab and preserves it across navigation without refetch', async () => {
    mount()
    expect(mocks.exceptions).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Принятые исключения' }))
    await waitFor(() => expect(mocks.exceptions).toHaveBeenCalledTimes(1))
    await act(async () => {
      focusManager.setFocused(false); focusManager.setFocused(true)
      onlineManager.setOnline(false); onlineManager.setOnline(true)
    })
    expect(mocks.exceptions).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('tab', { name: 'Системные правила' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Принятые исключения' }))
    expect(mocks.exceptions).toHaveBeenCalledTimes(1)
  })

  it('navigates reciprocal ZV/SP/DZ links, revealing their explanations without changing settings', () => {
    mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Защиты ввода' }))
    fireEvent.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'СП-09 · Целостность и продолжение цепочек' }))
    expect(screen.getByRole('tab', { name: 'Системные правила' })).toHaveAttribute('aria-selected', 'true')
    const chains = document.getElementById('system-rule-joint-chains')!
    expect(within(chains).getByText(/Свободный формат обычного имени/)).toBeVisible()
    fireEvent.click(within(chains).getByRole('button', { name: 'ДЗ-03 · Проверить дубли стыков' }))
    expect(screen.getByRole('tab', { name: 'Задачи диспетчера' })).toHaveAttribute('aria-selected', 'true')
    expect(document.getElementById('dispatcher-setting-help-chain-duplicate')).toBeVisible()
    expect(mocks.settingsPassword).not.toHaveBeenCalled()
    expect(mocks.exceptions).not.toHaveBeenCalled()
  })

  it('opens exception deep links directly and supports keyboard subtabs', async () => {
    window.history.replaceState(null, '', '/settings#rules-accepted-exceptions')
    mount()
    const exceptions = screen.getByRole('tab', { name: 'Принятые исключения' })
    expect(exceptions).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(mocks.exceptions).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(exceptions, { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'Системные правила' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Системные правила' })).toHaveAttribute('aria-selected', 'true')
  })
})
