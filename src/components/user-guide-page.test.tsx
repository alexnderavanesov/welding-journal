import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { UserGuidePage } from '@/components/user-guide-page'

describe('UserGuidePage', () => {
  it('opens with concise workflows and loads the full reference on demand', async () => {
    render(<UserGuidePage />)

    expect(screen.getByRole('button', { name: 'Кратко' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'С чего начать' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Справочная карта системы/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Все правила' }))

    expect(screen.getByRole('button', { name: 'Все правила' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByRole('link', { name: /Справочная карта системы/ })).toBeInTheDocument()
    const referenceLinks = screen.getAllByRole('link')
    expect(referenceLinks).toHaveLength(18)
    expect(referenceLinks.at(-2)).toHaveTextContent('Таблицы правил и кейсов')
    expect(referenceLinks.at(-1)).toHaveTextContent('Настройки')
  })

  it('shows one selected workflow instead of the whole guide', () => {
    render(<UserGuidePage />)

    fireEvent.click(screen.getByRole('link', { name: /ЛНК: заявки и результаты/ }))

    expect(screen.getByRole('heading', { name: 'ЛНК: заявки и результаты' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'С чего начать', hidden: true }).closest('.hidden')).toBeInTheDocument()
    expect(screen.getByText('4 из 12')).toBeInTheDocument()
  })

  it('searches inside the selected guide mode and can clear an empty result', () => {
    render(<UserGuidePage />)

    const search = screen.getByRole('textbox', { name: 'Поиск по руководству' })
    fireEvent.change(search, { target: { value: 'несуществующий термин' } })

    expect(screen.getByText('По этому запросу ничего не найдено.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }))

    expect(search).toHaveValue('')
    expect(screen.getByRole('heading', { name: 'С чего начать' })).toBeInTheDocument()
  })

  it('explains that replacement import cannot erase completed control history', async () => {
    render(<UserGuidePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Все правила' }))

    expect((await screen.findAllByText(/ЗВ-27 заблокирует весь импорт/)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/может очистить заявку, результат, заключение и дату/)).not.toBeInTheDocument()
  })
})
