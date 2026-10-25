import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentsGridToolbar, type DocumentsGridToolbarProps } from './documents-grid-toolbar'
import { DOCUMENT_GRID_DEFAULT_APPEARANCE } from '@/lib/document-history-grid-state'

function defaults(overrides: Partial<DocumentsGridToolbarProps> = {}): DocumentsGridToolbarProps {
  return {
    columns: [{ key: 'title', label: 'Документ', minWidth: 200, required: true }, { key: 'project', label: 'Проект', minWidth: 100 }, { key: 'stage', label: 'Этап', minWidth: 100 }],
    visibleColumnKeys: new Set(['title', 'project']), onColumnVisibilityChange: vi.fn(), onShowAllColumns: vi.fn(), onHideAllColumns: vi.fn(),
    appearance: { ...DOCUMENT_GRID_DEFAULT_APPEARANCE }, onAppearanceChange: vi.fn(), onResetColumns: vi.fn(),
    savedViews: [], onSaveView: vi.fn(), onApplyView: vi.fn(), onDeleteView: vi.fn(),
    search: '', onSearchChange: vi.fn(), hasFilters: false, onClearFilters: vi.fn(),
    settingsOpen: false, onSettingsOpenChange: vi.fn(), ...overrides,
  }
}
function Harness({ options }: { options: DocumentsGridToolbarProps }) {
  const [open, setOpen] = useState(options.settingsOpen)
  return <DocumentsGridToolbar {...options} settingsOpen={open} onSettingsOpenChange={value => { options.onSettingsOpenChange(value); setOpen(value) }} />
}
const openSettings = () => fireEvent.click(screen.getByRole('button', { name: 'Настроить вид' }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('document grid toolbar presentation', () => {
  it('shows the journal tabs and searches columns without altering the registry query or hidden filters', () => {
    const props = defaults({ search: 'stored query', hasFilters: true })
    render(<Harness options={props} />)
    openSettings()
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Столбцы', 'Оформление', 'Темы', 'Мои виды'])
    expect(screen.getByText('2 из 3 столбцов · сохраняется в этом браузере')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Документ' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Этап' })).not.toBeChecked()
    fireEvent.change(screen.getByRole('textbox', { name: 'Найти столбец' }), { target: { value: 'ПРО' } })
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Проект' }))
    expect(props.onColumnVisibilityChange).toHaveBeenCalledWith('project', false)
    fireEvent.click(screen.getByRole('button', { name: 'Показать все' }))
    expect(props.onShowAllColumns).toHaveBeenCalledTimes(1)
    expect(props.onClearFilters).not.toHaveBeenCalled()
    expect(props.onSearchChange).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Поиск документов' })).toHaveValue('stored query')
    fireEvent.change(screen.getByRole('textbox', { name: 'Найти столбец' }), { target: { value: 'missing' } })
    expect(screen.getByRole('status')).toHaveTextContent('Столбцы не найдены')
  })

  it('offers hide all when all columns are visible, even with column search active', () => {
    const props = defaults({ visibleColumnKeys: new Set(['title', 'project', 'stage']) })
    render(<Harness options={props} />); openSettings()
    fireEvent.change(screen.getByRole('textbox', { name: 'Найти столбец' }), { target: { value: 'Проект' } })
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть все' }))
    expect(props.onHideAllColumns).toHaveBeenCalledOnce()
    expect(props.onShowAllColumns).not.toHaveBeenCalled()
  })

  it('keeps a hidden-column filter discoverable in settings and resets it through the common toolbar', () => {
    const props = defaults({ filteredColumnKeys: new Set(['stage']), hasFilters: true })
    render(<Harness options={props} />); openSettings()
    expect(screen.getByRole('checkbox', { name: 'Этап' })).not.toBeChecked()
    expect(screen.getByLabelText('Активный фильтр: Этап')).toHaveAttribute('title', 'Фильтр действует и для скрытого столбца')
    expect(screen.queryByLabelText('Активный фильтр: Проект')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(props.onClearFilters).toHaveBeenCalledTimes(1)
    expect(props.onColumnVisibilityChange).not.toHaveBeenCalled()
  })

  it('uses density keyboard selection, independent switches and theme cards, without journal task settings', () => {
    const props = defaults()
    render(<Harness options={props} />); openSettings()
    const columnsTab = screen.getByRole('tab', { name: 'Столбцы' })
    columnsTab.focus(); fireEvent.keyDown(columnsTab, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Оформление' })).toHaveFocus()
    const density = screen.getByRole('combobox', { name: 'Плотность строк документов' })
    fireEvent.keyDown(density, { key: 'ArrowDown' }); fireEvent.keyDown(density, { key: 'Home' }); fireEvent.keyDown(density, { key: 'Enter' })
    expect(props.onAppearanceChange).toHaveBeenLastCalledWith({ ...props.appearance, density: 'compact' })
    expect(density).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(3)
    fireEvent.click(screen.getByRole('switch', { name: 'Перенос текста' }))
    expect(props.onAppearanceChange).toHaveBeenLastCalledWith({ ...props.appearance, wrapText: false })
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить столбцы' }))
    expect(props.onResetColumns).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('tab', { name: 'Темы' }))
    const themes = screen.getByRole('radiogroup', { name: 'Тема таблицы документов' })
    expect(within(themes).getAllByRole('radio')).toHaveLength(3)
    expect(within(themes).getByRole('radio', { name: /Светлая/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(themes).getByRole('radio', { name: /Классическая/ }))
    expect(props.onAppearanceChange).toHaveBeenLastCalledWith({ ...props.appearance, theme: 'alpine' })
  })

  it('closes density first on Escape, then settings, and preserves an overlaid modal', () => {
    const props = defaults()
    render(<Harness options={props} />); openSettings()
    fireEvent.click(screen.getByRole('tab', { name: 'Оформление' }))
    const density = screen.getByRole('combobox')
    fireEvent.click(density)
    expect(density).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    const modal = document.createElement('div'); modal.dataset.modalDialog = 'true'; document.body.append(modal)
    fireEvent.keyDown(density, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    modal.remove(); fireEvent.keyDown(density, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Настроить вид' })).toHaveFocus()
  })

  it('saves trimmed names, describes saved views and restores focus after applying one', () => {
    const props = defaults({ savedViews: [{ id: 'view-1', name: 'Контроль', appearance: { ...DOCUMENT_GRID_DEFAULT_APPEARANCE }, columns: [{ colId: 'project', hide: true }], filters: { project: 'choice', line: '' }, search: 'needed' }] })
    render(<Harness options={props} />); openSettings()
    fireEvent.click(screen.getByRole('tab', { name: 'Мои виды' }))
    expect(screen.getByText('Фильтров: 1 · скрыто столбцов: 1 · с поиском')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Название вида документов' }), { target: { value: '  Рабочий  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(props.onSaveView).toHaveBeenCalledWith('Рабочий')
    expect(screen.getByRole('status')).toHaveTextContent('Вид сохранён')
    fireEvent.click(screen.getByRole('button', { name: 'Удалить вид Контроль' }))
    expect(props.onDeleteView).toHaveBeenCalledWith('view-1')
    expect(props.onApplyView).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^Контроль Фильтров:/ }))
    expect(props.onApplyView).toHaveBeenCalledWith('view-1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Настроить вид' })).toHaveFocus()
  })

  it('does not report a rejected save as successful and returns external column requests to the columns tab', () => {
    const props = defaults({ onSaveView: vi.fn(() => false) })
    const view = render(<Harness options={props} />); openSettings()
    fireEvent.click(screen.getByRole('tab', { name: 'Мои виды' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Название вида документов' }), { target: { value: 'Draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Название вида документов' })).toHaveValue('Draft')
    view.rerender(<Harness options={{ ...props, openColumnsRequest: 1 }} />)
    expect(screen.getByRole('tab', { name: 'Столбцы' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.rerender(<Harness options={{ ...props, openColumnsRequest: 1, onSearchChange: vi.fn() }} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps registry controls active while pending selection disables document actions', () => {
    const props = defaults({ hasFilters: true, actionsDisabled: true, actions: <button>Архив</button>, groupingControls: <button>Группировка</button> })
    render(<Harness options={props} />)
    expect(screen.getByRole('button', { name: 'Архив' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Группировка' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(props.onClearFilters).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByRole('textbox', { name: 'Поиск документов' }), { target: { value: 'find' } })
    expect(props.onSearchChange).toHaveBeenCalledWith('find')
  })
})
