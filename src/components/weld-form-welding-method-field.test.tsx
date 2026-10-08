import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { WeldFormTestTypesField, WeldFormWeldingMethodField } from './weld-form-welding-method-field'

beforeEach(() => localStorage.clear())

function Form({ testTypes = false }: { testTypes?: boolean }) {
  const [value, setValue] = useState<string | null>(null)
  const Field = testTypes ? WeldFormTestTypesField : WeldFormWeldingMethodField
  return <><Field value={value} onChange={setValue} /><output aria-label="Запись">{value ?? ''}</output></>
}

it('keeps the compact clear action in place and preserves welding method selection', () => {
  render(<Form />)
  const clear = screen.getByRole('button', { name: 'Очистить' })
  expect(clear).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'РАД' }))
  fireEvent.click(screen.getByRole('button', { name: 'РД' }))
  expect(screen.getByLabelText('Запись')).toHaveTextContent('РАД+РД')
  expect(clear).toBeEnabled()
  fireEvent.click(clear)
  expect(screen.getByLabelText('Запись')).toBeEmptyDOMElement()
  expect(clear).toBeDisabled()
  expect(clear).toBe(screen.getByRole('button', { name: 'Очистить' }))
})

it('retains the existing text action and comma-separated values for test types', () => {
  render(<Form testTypes />)
  expect(screen.queryByRole('button', { name: 'Очистить' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'ГИ' }))
  fireEvent.click(screen.getByRole('button', { name: 'ПИ' }))
  expect(screen.getByLabelText('Запись')).toHaveTextContent('ГИ, ПИ')
  const clear = screen.getByRole('button', { name: 'Очистить' })
  expect(clear).toHaveTextContent('Очистить')
  fireEvent.click(clear)
  expect(screen.getByLabelText('Запись')).toBeEmptyDOMElement()
  expect(screen.queryByRole('button', { name: 'Очистить' })).toBeNull()
})
