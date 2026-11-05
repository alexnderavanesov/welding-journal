import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WelderStampsRegistry, type WelderStampsRegistryProps } from './welder-stamps-registry'
import { createEmptyWelderStampDraft } from '@/lib/welder-stamp-registry'
import { createEmptyWelderStampFilters } from '@/lib/welder-stamp-filters'
import { createEmptyNaksPermit } from '@/lib/welder-stamp-permits'

afterEach(cleanup)
vi.mock('./technology-cards-registry', () => ({ TechnologyCardsRegistry: () => <p>Реестр ТК</p> }))
vi.mock('./specialists-registry', () => ({ SpecialistsRegistry: () => <p>Реестр специалистов</p> }))

function props(): WelderStampsRegistryProps {
  const record = { ...createEmptyWelderStampDraft(), id: 1, naksStamp: 'ABCD', welderName: 'Тестовый сварщик' }
  return {
    records: [record], allRecords: [record], suspensionRecords: [], draft: createEmptyWelderStampDraft(),
    suspensionDraft: { id: 0, naksStamp: '', suspendedFrom: '', suspendedTo: '' },
    search: '', filters: createEmptyWelderStampFilters(), editingId: null,
    onSearchChange: vi.fn(), onFiltersChange: vi.fn(), onDraftChange: vi.fn(), onSuspensionDraftChange: vi.fn(),
    onSave: vi.fn(() => true), onSaveSuspension: vi.fn(() => true), onReset: vi.fn(), onResetSuspension: vi.fn(),
    onEdit: vi.fn(), onEditSuspension: vi.fn(), onArchive: vi.fn(), onRestore: vi.fn(), onArchivePermit: vi.fn(),
    onRestorePermit: vi.fn(), onDelete: vi.fn(), onDeleteSuspension: vi.fn(),
  }
}

describe('welder registry tabs', () => {
  it('opens a direct specialist link without mounting stamps, then preserves the visited stamp card', () => {
    const previousUrl = window.location.href
    window.history.replaceState(null, '', '/references?tab=specialists')
    try {
      render(<WelderStampsRegistry {...props()} />)
      expect(screen.queryByText('ABCD')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('tab', { name: 'Клейма' }))
      fireEvent.click(screen.getByText('ABCD'))
      const card = screen.getByRole('heading', { name: 'Тестовый сварщик' })
      fireEvent.click(screen.getByRole('tab', { name: 'Специалисты' }))
      expect(card).not.toBeVisible()
      fireEvent.click(screen.getByRole('tab', { name: 'Клейма' }))
      expect(card).toBeVisible()
      expect(screen.getByRole('heading', { name: 'Тестовый сварщик' })).toBe(card)
    } finally { window.history.replaceState(null, '', previousUrl) }
  })

  it('keeps the empty message outside the wide table so narrow screens do not hide it', () => {
    render(<WelderStampsRegistry {...props()} records={[]} allRecords={[]} />)
    const region = screen.getByRole('region', { name: 'Таблица клейм — горизонтальная прокрутка' })
    expect(within(region).getByText('Пока нет добавленных клейм.')).toBeVisible()
    expect(within(region).queryByRole('table')).not.toBeInTheDocument()
  })

  it('keeps the records in a keyboard-accessible scroll region with readable column widths', () => {
    render(<WelderStampsRegistry {...props()} />)
    const region = screen.getByRole('region', { name: 'Таблица клейм — горизонтальная прокрутка' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(region).toHaveClass('overflow-x-auto', 'min-w-0')
    expect(within(region).getByRole('table')).toHaveClass('min-w-[1120px]')
    fireEvent.click(within(region).getByText('ABCD'))
    expect(within(region).getByRole('heading', { name: 'Тестовый сварщик' })).toBeVisible()
  })

  it('locks the draft and closing while saving, then retains the editor on failure', async () => {
    const handlers = props()
    let resolve!: (saved: boolean) => void
    handlers.onSave = vi.fn(() => new Promise<boolean>(done => { resolve = done }))
    handlers.editingId = 1
    handlers.draft = { ...handlers.allRecords[0], naksPermits: [{ ...createEmptyNaksPermit(), id: 'audit',
      weldType: 'РАД', materialGroups: 'М01', diameterFrom: '1', diameterTo: '500', thicknessFrom: '1', thicknessTo: '20',
      validFrom: '2026-01-01', validTo: '2026-12-31' }] }
    render(<WelderStampsRegistry {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить клеймо' }))
    vi.mocked(handlers.onReset).mockClear()
    const dialog = screen.getByRole('dialog')
    const save = within(dialog).getByRole('button', { name: 'Сохранить клеймо' })
    expect(save).not.toBeDisabled()
    fireEvent.click(save)
    expect(save).toBeDisabled()
    expect(dialog.querySelector('fieldset')).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(save)
    expect(handlers.onSave).toHaveBeenCalledOnce()
    expect(handlers.onReset).not.toHaveBeenCalled()
    expect(dialog).toBeVisible()
    await act(async () => resolve(false))
    expect(dialog).toBeVisible()
    expect(save).not.toBeDisabled()
  })

  it('keeps the registry as the default and leaves qualification parameters in system rules', () => {
    render(<WelderStampsRegistry {...props()} header={<h1>Клейма</h1>} taskPanels={<p>Диспетчер оповещений клейм</p>} />)
    expect(screen.getByRole('tab', { name: 'Клейма' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Добавить клеймо' })).toBeVisible()
    expect(screen.queryByRole('tab', { name: 'Параметры проверки' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Клейма')
    expect(screen.getByText('Диспетчер оповещений клейм')).toBeVisible()
  })

  it('preserves the opened filter panel, entered fields, status and expanded card across tab switches', () => {
    const handlers = props()
    function Harness() {
      const [search, setSearch] = useState('')
      const [filters, setFilters] = useState(createEmptyWelderStampFilters)
      return <WelderStampsRegistry {...handlers} search={search} onSearchChange={setSearch} filters={filters} onFiltersChange={setFilters} />
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Фильтры и поиск/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Поиск' }), { target: { value: 'ABCD' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Диаметр от' }), { target: { value: '57' } })
    fireEvent.click(screen.getByRole('button', { name: /Нужно заполнить/ }))
    fireEvent.click(screen.getByText('ABCD'))
    const heading = screen.getByRole('heading', { name: 'Тестовый сварщик' })
    expect(heading).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Специалисты' }))
    expect(heading).not.toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Клейма' }))
    expect(screen.getByRole('textbox', { name: 'Поиск' })).toHaveValue('ABCD')
    expect(screen.getByRole('textbox', { name: 'Диаметр от' })).toHaveValue('57')
    expect(screen.getByRole('button', { name: /Нужно заполнить/ })).toHaveAttribute('aria-pressed', 'true')
    expect(heading).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Тестовый сварщик' })).toBe(heading)
    expect(handlers.onReset).not.toHaveBeenCalled()
  })

  it('supports arrow keys, Home and End with focus and panel relationships', async () => {
    render(<WelderStampsRegistry {...props()} />)
    const registry = screen.getByRole('tab', { name: 'Клейма' })
    const cards = screen.getByRole('tab', { name: 'Технологические карты' })
    const specialists = screen.getByRole('tab', { name: 'Специалисты' })
    for (const [tab, key, target] of [[registry, 'ArrowRight', specialists], [specialists, 'ArrowRight', cards], [cards, 'ArrowRight', registry], [registry, 'End', cards], [cards, 'Home', registry], [registry, 'ArrowLeft', cards]] as const) {
      // A newly visited technology-card tab resolves React.lazy asynchronously.
      await act(async () => { fireEvent.keyDown(tab, { key }) })
      expect(target).toHaveFocus()
      expect(target).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tabpanel')).toHaveAttribute('id', target.getAttribute('aria-controls'))
      expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', target.id)
      if (target === cards) expect(within(screen.getByRole('tabpanel')).getByText('Реестр ТК')).toBeVisible()
    }
  })

  it('returns to the registry for an externally requested suspension editor', () => {
    const handlers = props()
    const { rerender } = render(<WelderStampsRegistry {...handlers} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Специалисты' }))
    rerender(<WelderStampsRegistry {...handlers} suspensionEditorOpenSignal={1} />)
    expect(screen.getByRole('tab', { name: 'Клейма' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('dialog')).toBeVisible()
  })
})
