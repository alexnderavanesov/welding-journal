import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WelderStampCheckExample } from './welder-stamp-check-example'

afterEach(cleanup)
describe('interactive stamp check example', () => {
  it('switches a dissimilar two-welder example to T without hidden geometry or crew affecting it', () => {
    render(<WelderStampCheckExample />)
    screen.getByText('Разобрать свой пример').closest('details')!.open = true
    fireEvent.change(screen.getByLabelText('Группа 2'), { target: { value: 'М05' } })
    fireEvent.change(screen.getByLabelText('Количество клейм'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Способ сварки стыка'), { target: { value: 'РАД+РД' } })
    fireEvent.change(screen.getByLabelText('Сварщик Б — способ'), { target: { value: 'РАД' } })
    fireEvent.change(screen.getByLabelText('Диаметр D2, мм'), { target: { value: 'wrong' } })
    fireEvent.change(screen.getByLabelText('Толщина T2, мм'), { target: { value: '-3' } })
    fireEvent.change(screen.getByLabelText('Тип соединения'), { target: { value: 'Т' } })
    const output = within(screen.getByRole('region', { name: 'Результат разбора примера' }))
    expect(output.getByText(/комбинированная сварка запрещена/)).toBeVisible()
    fireEvent.change(screen.getByLabelText('Способ сварки стыка'), { target: { value: 'РАД' } })
    expect(output.queryByText(/Дополните параметры/)).not.toBeInTheDocument()
    expect(output.getAllByRole('article')).toHaveLength(1)
    expect(output.getByRole('article')).toHaveTextContent('Сварщик А · РАД')
    expect(output.getAllByText('D1 = 108 мм')).toHaveLength(1)
    expect(output.getAllByText('T1 = 4 мм')).toHaveLength(1)
    expect(output.getByText('М01')).toBeVisible()
    expect(output.queryByText('М05')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Диаметр D2, мм')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Толщина T2, мм')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Сварщик Б — способ')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Количество клейм')).toBeDisabled()
    expect(within(screen.getByLabelText('Количество клейм')).queryByRole('option', { name: '2 — А и Б' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Тип соединения'), { target: { value: 'С17' } })
    expect(screen.getByLabelText('Диаметр D2, мм')).toHaveValue('')
    expect(screen.getByLabelText('Толщина T2, мм')).toHaveValue('')
    expect(screen.getByLabelText('Количество клейм')).toHaveValue('1')
    expect(screen.getByLabelText('Количество клейм')).not.toBeDisabled()
  })

  it('checks positive pipe dimensions for T, including combined errors, without requiring a second pair', () => {
    render(<WelderStampCheckExample />)
    screen.getByText('Разобрать свой пример').closest('details')!.open = true
    fireEvent.change(screen.getByLabelText('Тип соединения'), { target: { value: 'Т' } })
    fireEvent.change(screen.getByLabelText('Диаметр D1, мм'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Толщина T1, мм'), { target: { value: '0' } })
    const output = within(screen.getByRole('region', { name: 'Результат разбора примера' }))
    expect(output.getByText(/^D1: укажите положительное/)).toBeVisible()
    expect(output.getByText(/^T1: укажите положительное/)).toBeVisible()
    expect(output.queryByText(/^D2:/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Диаметр D1, мм'), { target: { value: '57,5' } })
    fireEvent.change(screen.getByLabelText('Толщина T1, мм'), { target: { value: '6,25' } })
    expect(output.getByText('D1 = 57.5 мм')).toBeVisible()
    expect(output.getByText('T1 = 6.25 мм')).toBeVisible()
    expect(output.getAllByRole('article')).toHaveLength(1)
  })

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
