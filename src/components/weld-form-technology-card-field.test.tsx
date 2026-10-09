import { useRef, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { TechnologyCardSnapshot } from '@/lib/technology-card-review'
import { WeldFormTechnologyCardField } from './weld-form-technology-card-field'

const query = vi.hoisted(() => ({ data: undefined as TechnologyCardSnapshot | undefined, isError: false, isFetching: false, refetch: vi.fn() }))
vi.mock('@/lib/technology-card-query', () => ({ useTechnologyCardSnapshot: () => query }))
const card = { id: 1, revision: 2, name: 'ТК №1', weldingMethods: ['РАД'], connectionType: 'С17', materialGroups: ['М01'], diameterFrom: 1, diameterTo: 200, thicknessFrom: 1, thicknessTo: 10, psto: 'any' as const, archived: false }

function Form() {
  const [draft, setDraft] = useState<WeldInput>({ technologyCardNumber: 'Старая ТК', weldingMethod: 'РАД', connectionType: 'С17', materialGroup: 'М01', d1: 57, d2: 57, t1: 3, t2: 3 })
  const fieldRefs = useRef<Partial<Record<WeldFieldKey, HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null>>>({})
  return <><WeldFormTechnologyCardField draft={draft} setDraft={setDraft} fieldRefs={fieldRefs} /><span data-testid="draft">{JSON.stringify(draft)}</span></>
}
beforeEach(() => {
  localStorage.clear(); query.refetch.mockClear(); query.isError = false; query.isFetching = false
  query.data = { cards: [card], names: [{ name: card.name, cardId: card.id }] }
})

it('keeps compact controls mounted on clear/typing and stores an explicit versioned selection', () => {
  render(<Form />)
  const input = screen.getByRole('textbox'), select = screen.getByLabelText('Выбрать подходящую ТК')
  const line = select.parentElement
  expect(screen.getByRole('status')).toHaveTextContent('ТК нет в реестре')
  fireEvent.change(input, { target: { value: '' } })
  expect(screen.getByRole('status')).toHaveTextContent('Подходит 1 ТК')
  expect(screen.getByLabelText('Выбрать подходящую ТК').parentElement).toBe(line)
  expect(line).toHaveClass('h-7')
  fireEvent.change(select, { target: { value: '1' } })
  expect(input).toHaveValue(card.name)
  expect(screen.getByTestId('draft')).toHaveTextContent('"technologyCardSelection":{"id":1,"revision":2}')
  fireEvent.change(input, { target: { value: 'Вручную' } })
  expect(screen.getByTestId('draft')).not.toHaveTextContent('technologyCardSelection')
  expect(query.refetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Обновить список ТК' }))
  expect(query.refetch).toHaveBeenCalledOnce()
})

it('moves full explanations into a portal, preserving the fixed controls on load/error/no matches', () => {
  const { rerender } = render(<Form />)
  fireEvent.click(screen.getByRole('button', { name: 'Подбор технологической карты' }))
  const field = screen.getByTestId('technology-card-field')
  expect(field).not.toContainElement(screen.getByRole('tooltip'))
  expect(screen.getByRole('tooltip')).toHaveTextContent('В уже заваренном стыке выберите ТК вручную')
  const select = screen.getByLabelText('Выбрать подходящую ТК')
  for (const value of [undefined, { cards: [], names: [] }]) {
    query.data = value; rerender(<Form />)
    expect(select).toBeDisabled()
    expect(screen.getByLabelText('Выбрать подходящую ТК')).toBe(select)
  }
  query.isError = true; rerender(<Form />)
  expect(screen.getByRole('alert')).toHaveTextContent('Реестр недоступен')
  expect(screen.getByRole('textbox')).toHaveValue('Старая ТК')
})
