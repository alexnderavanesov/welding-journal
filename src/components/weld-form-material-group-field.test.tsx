import { createRef, useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { WeldFormMaterialGroupField } from './weld-form-material-group-field'

beforeEach(() => localStorage.clear())
function Form({ initial = null }: { initial?: string | null }) {
  const [value, setValue] = useState(initial)
  return <><WeldFormMaterialGroupField value={value} onChange={setValue} /><output aria-label="Запись">{value ?? ''}</output></>
}
it('keeps selection order, limits to two and swaps only after an explicit action', () => {
  render(<Form />)
  fireEvent.click(screen.getByRole('button', { name: 'М05' }))
  expect(screen.getByLabelText('Запись')).toHaveTextContent('М05')
  expect(within(screen.getByRole('button', { name: 'М05' })).getByText('1/2')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'М01' }))
  expect(screen.getByLabelText('Запись')).toHaveTextContent('М05 + М01')
  expect(within(screen.getByRole('button', { name: 'М05' })).getByText('1')).toBeVisible()
  expect(within(screen.getByRole('button', { name: 'М01' })).getByText('2')).toBeVisible()
  expect(screen.getByRole('button', { name: 'М11' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Поменять 1 ↔ 2' }))
  expect(screen.getByLabelText('Запись')).toHaveTextContent('М01 + М05')
  fireEvent.click(screen.getByRole('button', { name: 'М01' }))
  expect(screen.getByLabelText('Запись')).toHaveTextContent('М05')
  expect(screen.getByRole('button', { name: 'М11' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Очистить' }))
  expect(screen.getByLabelText('Запись')).toBeEmptyDOMElement()
  expect(screen.getByRole('button', { name: 'Очистить' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Поменять 1 ↔ 2' })).toBeDisabled()
})
it('shows an existing custom value rather than dropping it when the dictionary changes', () => {
  render(<Form initial="М02 + М01" />)
  expect(screen.getByLabelText('Запись')).toHaveTextContent('М02 + М01')
  expect(screen.getByRole('button', { name: 'М02' })).toHaveAttribute('aria-pressed', 'true')
})
it('focuses an enabled material button when the first dictionary option is unavailable', () => {
  const inputRef = createRef<HTMLButtonElement>()
  render(<WeldFormMaterialGroupField value="М05 + М11" inputRef={inputRef} onChange={() => {}} />)
  expect(screen.getByRole('button', { name: 'М01' })).toBeDisabled()
  inputRef.current!.focus()
  expect(screen.getByRole('button', { name: 'М05' })).toHaveFocus()
  expect(inputRef.current).toHaveAttribute('aria-description', 'Материал 1: D1/T1')
})
