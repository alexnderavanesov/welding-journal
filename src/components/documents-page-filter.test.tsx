import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import {
  DocumentHistoryColumnFilter,
  getDocumentActionErrorMessage,
  getDocumentNavigationColumnFilters,
  getDocumentNavigationViewId,
} from '@/components/documents-page'
import { parseWeldColumnChoiceFilter } from '@/lib/weld-table-filtering'

describe('DocumentHistoryColumnFilter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the open menu in a fixed body portal outside the clipped table', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 56,
      y: 52,
      left: 56,
      right: 216,
      top: 52,
      bottom: 84,
      width: 160,
      height: 32,
      toJSON: () => ({}),
    })

    render(
      <div className="overflow-hidden">
        <DocumentHistoryColumnFilter
          label="Этап"
          value=""
          options={[{ value: 'main', label: 'Основной', count: 2 }]}
          onChange={() => undefined}
        />
      </div>,
    )

    fireEvent.click(screen.getByTitle('Фильтр: Этап'))

    const menu = screen.getByRole('dialog', { name: 'Фильтр: Этап' })
    expect(menu.parentElement).toBe(document.body)
    expect(menu).toHaveClass('fixed')
    expect(menu).toHaveStyle({ left: '56px', top: '90px', width: '288px', maxHeight: '420px' })
    expect(screen.getByText('Основной')).toBeInTheDocument()
  })

  it('closes the portal menu when the user clicks outside it', () => {
    render(
      <DocumentHistoryColumnFilter
        label="Этап"
        value=""
        options={[{ value: 'main', label: 'Основной', count: 2 }]}
        onChange={() => undefined}
      />,
    )

    fireEvent.click(screen.getByTitle('Фильтр: Этап'))
    expect(screen.getByRole('dialog', { name: 'Фильтр: Этап' })).toBeInTheDocument()

    fireEvent.pointerDown(document.body)

    expect(screen.queryByRole('dialog', { name: 'Фильтр: Этап' })).not.toBeInTheDocument()
  })

  it('selects only searched values, preserves their view, and closes with Escape', () => {
    function FilterHarness() {
      const [value, setValue] = useState('')
      return (
        <>
          <span data-testid="document-filter-value">{value}</span>
          <DocumentHistoryColumnFilter
            label="Документ"
            value={value}
            options={[
              { value: '0104-1', label: '0104-1', count: 1 },
              { value: '330-ТКМ5-5498-До ТО', label: '330-ТКМ5-5498-До ТО', count: 1 },
              { value: '330-ТКМ5-5513-До ТО', label: '330-ТКМ5-5513-До ТО', count: 1 },
            ]}
            onChange={setValue}
          />
        </>
      )
    }

    render(<FilterHarness />)

    const trigger = screen.getByTitle('Фильтр: Документ')
    fireEvent.click(trigger)
    fireEvent.change(screen.getByPlaceholderText('Найти значение'), { target: { value: 'до то' } })
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать все' }))

    expect(parseWeldColumnChoiceFilter(screen.getByTestId('document-filter-value').textContent ?? ''))
      .toEqual({
        kind: 'values',
        values: ['330-ТКМ5-5498-До ТО', '330-ТКМ5-5513-До ТО'],
      })

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    fireEvent.click(trigger)

    expect(screen.getByPlaceholderText('Найти значение')).toHaveValue('до то')
    expect(screen.getByRole('button', { name: /330-ТКМ5-5498-До ТО/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /330-ТКМ5-5513-До ТО/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /0104-1/ })).not.toBeInTheDocument()

    fireEvent.keyDown(screen.getByPlaceholderText('Найти значение'), { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Фильтр: Документ' })).not.toBeInTheDocument()
    expect(parseWeldColumnChoiceFilter(screen.getByTestId('document-filter-value').textContent ?? ''))
      .toEqual({
        kind: 'values',
        values: ['330-ТКМ5-5498-До ТО', '330-ТКМ5-5513-До ТО'],
      })
  })

  it('leaves the background filter open when Escape belongs to a modal above it', () => {
    render(
      <DocumentHistoryColumnFilter
        label="Этап"
        value=""
        options={[{ value: 'main', label: 'Основной', count: 2 }]}
        onChange={() => undefined}
      />,
    )

    fireEvent.click(screen.getByTitle('Фильтр: Этап'))
    const modal = document.createElement('div')
    modal.dataset.modalDialog = 'true'
    document.body.append(modal)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.getByRole('dialog', { name: 'Фильтр: Этап' })).toBeInTheDocument()
    modal.remove()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Фильтр: Этап' })).not.toBeInTheDocument()
  })
})

describe('getDocumentActionErrorMessage', () => {
  it('does not expose database queries in document errors', () => {
    expect(getDocumentActionErrorMessage(
      new Error('Server error: Failed query: select * from "weld_joints"'),
      'Не удалось выполнить действие с документом.',
    )).toBe('Не удалось выполнить действие с документом.')
  })

  it('preserves user-facing validation messages', () => {
    expect(getDocumentActionErrorMessage(
      new Error('Название документа уже занято.'),
      'Не удалось выполнить действие с документом.',
    )).toBe('Название документа уже занято.')
  })
})

describe('document navigation filters', () => {
  it('opens generated journal documents in their view with an exact title filter', () => {
    const request = {
      requestId: 1,
      kind: 'generated' as const,
      documentId: 42,
      type: 'weldingJournal' as const,
      title: 'ЖСР-17',
    }

    expect(getDocumentNavigationViewId(request)).toBe('weldingJournal')
    expect(parseWeldColumnChoiceFilter(getDocumentNavigationColumnFilters(request).title)).toEqual({
      kind: 'values',
      values: ['ЖСР-17'],
    })
  })

  it('selects the exact LNK, PSTO, and layered document registries', () => {
    expect(getDocumentNavigationViewId({
      requestId: 2,
      kind: 'system',
      type: 'lnkConclusion',
      title: 'ВИК-12',
      date: '2026-09-18',
      methodCode: 'ВИК',
    })).toBe('lnkConclusion')
    expect(getDocumentNavigationViewId({
      requestId: 3,
      kind: 'system',
      type: 'pstoConclusion',
      title: 'ПСТО-8',
      date: '2026-09-18',
    })).toBe('pstoConclusion')
    expect(getDocumentNavigationViewId({
      requestId: 4,
      kind: 'generated',
      documentId: 84,
      type: 'layeredVikLayers',
      title: 'ВИК слоев-84',
    })).toBe('layeredVik')
  })
})
