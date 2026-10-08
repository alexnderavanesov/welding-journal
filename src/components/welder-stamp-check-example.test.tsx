import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WelderStampCheckExample } from './welder-stamp-check-example'

afterEach(cleanup)
describe('interactive stamp check example', () => {
  it('starts collapsed, keeps entered values on collapse and explains both sides per welder', () => {
    render(<WelderStampCheckExample />)
    const details = screen.getByText('Разобрать свой пример').closest('details')!
    expect(details.open).toBe(false)
    // Native details visibility is handled by the browser; enable it in jsdom.
    details.open = true
    for (const name of ['Стык', 'Стороны стыка', 'Сварщики']) expect(screen.getByRole('region', { name })).toBeVisible()
    for (const side of [1, 2]) {
      const group = within(screen.getByRole('group', { name: `Сторона ${side}` }))
      expect(group.getByRole('combobox', { name: `Группа ${side}` })).toBeVisible()
      expect(group.getByRole('textbox', { name: `Диаметр D${side}, мм` })).toBeVisible()
      expect(group.getByRole('textbox', { name: `Толщина T${side}, мм` })).toBeVisible()
    }
    fireEvent.change(screen.getByLabelText('Тип соединения'), { target: { value: 'У19' } })
    fireEvent.change(screen.getByLabelText('Диаметр D1, мм'), { target: { value: '57' } })
    fireEvent.change(screen.getByLabelText('Толщина T1, мм'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('Диаметр D2, мм'), { target: { value: '159' } })
    fireEvent.change(screen.getByLabelText('Толщина T2, мм'), { target: { value: '3' } })
    const output = within(screen.getByRole('region', { name: 'Результат разбора примера' }))
    expect(output.getByText('D1 = 57 мм')).toBeVisible()
    expect(output.getByText('T1 = 6 мм')).toBeVisible()
    expect(output.queryByText('T2 = 3 мм')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Группа 2'), { target: { value: 'М05' } })
    fireEvent.change(screen.getByLabelText('Количество клейм'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Способ сварки стыка'), { target: { value: 'РАД+РД' } })
    for (const worker of output.getAllByRole('article')) {
      expect(within(worker).getByText('D1 = 57 мм')).toBeVisible()
      expect(within(worker).getByText('T1 = 6 мм')).toBeVisible()
      expect(within(worker).getByText('D2 = 159 мм')).toBeVisible()
      expect(within(worker).getByText('T2 = 3 мм')).toBeVisible()
    }
    fireEvent.change(screen.getByLabelText('Сварщик Б — способ'), { target: { value: 'РАД' } })
    expect(output.getByText(/не указан исполнитель способа РД/)).toBeVisible()
    details.open = false
    details.open = true
    expect(screen.getByLabelText('Диаметр D1, мм')).toHaveValue('57')
    expect(output.getByText(/а не решение «допущен»/)).toBeVisible()
    expect(screen.queryByRole('button', { name: /Сохранить/ })).not.toBeInTheDocument()
  })

  it('keeps side values and method assignment when changing the crew or joint method', () => {
    render(<WelderStampCheckExample />)
    screen.getByText('Разобрать свой пример').closest('details')!.open = true
    fireEvent.change(screen.getByLabelText('Группа 2'), { target: { value: 'М05' } })
    fireEvent.change(screen.getByLabelText('Количество клейм'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Способ сварки стыка'), { target: { value: 'РАД+РД' } })
    fireEvent.change(screen.getByLabelText('Сварщик А — способ'), { target: { value: 'РД' } })
    fireEvent.change(screen.getByLabelText('Сварщик Б — способ'), { target: { value: 'РАД' } })
    fireEvent.change(screen.getByLabelText('Количество клейм'), { target: { value: '1' } })
    expect(screen.queryByLabelText('Сварщик Б — способ')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Сварщики' })).toHaveTextContent('А · РАД + РД')
    fireEvent.change(screen.getByLabelText('Количество клейм'), { target: { value: '2' } })
    expect(screen.getByLabelText('Сварщик А — способ')).toHaveValue('РД')
    expect(screen.getByLabelText('Сварщик Б — способ')).toHaveValue('РАД')
    fireEvent.change(screen.getByLabelText('Способ сварки стыка'), { target: { value: 'РД' } })
    expect(screen.queryByLabelText('Сварщик А — способ')).not.toBeInTheDocument()
    const crew = screen.getByRole('region', { name: 'Сварщики' })
    expect(crew).toHaveTextContent('А · РД')
    expect(crew).toHaveTextContent('Б · РД')
    expect(screen.getByLabelText('Группа 2')).toHaveValue('М05')
    expect(screen.getByLabelText('Толщина T2, мм')).toHaveValue('6')
  })
})
