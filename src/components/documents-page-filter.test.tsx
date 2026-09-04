import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  DocumentHistoryColumnFilter,
  getDocumentActionErrorMessage,
} from '@/components/documents-page'

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
