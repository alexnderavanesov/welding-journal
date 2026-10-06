import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { UserGuidePage } from '@/components/user-guide-page'

describe('UserGuidePage', () => {
  it('explains explicit line move decisions and visible retained pre-TO history', () => {
    render(<UserGuidePage />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Поиск по руководству' }), { target: { value: 'Смена линии: выбрать судьбу НК' } })
    expect(screen.getByText('Смена линии: выбрать судьбу НК до сохранения')).toBeInTheDocument()
    expect(screen.getByText(/окно не выбирает решение за вас/)).toBeInTheDocument()
    expect(screen.queryByText(/Заявка повторного цикла без фактической ПСТО удаляется/)).not.toBeInTheDocument()
  })
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

  it('does not teach the removed automatic layered workflow or cancellation data erasure', async () => {
    render(<UserGuidePage />)
    fireEvent.click(screen.getByRole('link', { name: /ЛНК: заявки и результаты/ }))
    expect(screen.getByText(/Послойный контроль назначается явно на официальном актуальном/)).toBeInTheDocument()
    expect(screen.getByText(/перенос годного комплекта через «Изменить этап контроля» в любую сторону также требует сначала вернуть официальность/)).toBeInTheDocument()
    expect(screen.queryByText(/После сохранения даты сварки У-стыка система без заявки автоматически/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Все правила' }))
    expect((await screen.findAllByText(/После явного назначения послойного контроля/)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Система сразу проверяет все заваренные У-стыки/)).not.toBeInTheDocument()
    expect(screen.getByText(/Отмена назначения не стирает фактические заявки/)).toBeInTheDocument()
  })

  it('points to confirmed date correction instead of requiring document deletion', async () => {
    render(<UserGuidePage />)
    fireEvent.click(screen.getByRole('button', { name: 'Все правила' }))
    expect((await screen.findAllByText(/Исправление даты не требует удаления заявки/)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/в управлении заявками ее нельзя поменять задним числом/)).not.toBeInTheDocument()
    expect(screen.queryByText(/дата ПСТО фиксируются при создании документа и не меняются через управление/)).not.toBeInTheDocument()
  })

  it('explains the confirmed reverse officiality rebuild and safe cancellation', async () => {
    render(<UserGuidePage />)
    fireEvent.click(screen.getByRole('button', { name: 'Все правила' }))
    expect(await screen.findByText('Вернуть официальность после ошибочной перестройки')).toBeInTheDocument()
    expect(screen.getByText(/Предпросмотр предложит вернуть существующему продолжению имя S1R1/)).toBeInTheDocument()
    expect(screen.getByText(/«Отмена» ничего не меняет. Годный результат/)).toBeInTheDocument()
  })
})
