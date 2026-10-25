import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { AutocompleteInput } from './autocomplete-input'

afterEach(cleanup)
it('offers bounded custom suggestions without restricting free text', () => {
  const options = Array.from({ length: 30 }, (_, i) => `NAKS${i}`)
  function Form() {
    const [value, setValue] = useState('')
    return <AutocompleteInput aria-label="Клеймо" value={value} options={options} onValueChange={setValue} />
  }
  render(<Form />)
  const input = screen.getByLabelText('Клеймо')
  fireEvent.focus(input)
  expect(screen.getAllByRole('option')).toHaveLength(15)
  for (let i = 0; i < 30; i++) fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(input).toHaveValue('NAKS29')
  fireEvent.change(input, { target: { value: 'naks29' } })
  expect(screen.getAllByRole('option')).toHaveLength(1)
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(input).toHaveValue('NAKS29')
  expect(screen.queryByRole('listbox')).toBeNull()
  fireEvent.change(input, { target: { value: 'NEW1' } })
  expect(input).toHaveValue('NEW1')
  expect(screen.queryByRole('listbox')).toBeNull()
  fireEvent.change(input, { target: { value: 'NAKS' } })
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(input).toHaveValue('NAKS')
})
