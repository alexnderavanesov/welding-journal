import { useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WeldFormField } from './weld-form-field'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'

afterEach(cleanup)

const stampFields = ['stamp1K', 'stamp1Z', 'stamp1O', 'stamp2K', 'stamp2Z', 'stamp2O',
  'stamp1KFact', 'stamp1ZFact', 'stamp1OFact', 'stamp2KFact', 'stamp2ZFact', 'stamp2OFact'] as const

it('does not mistake the empty visible placeholder for an already cleared draft', () => {
  const setDraft = vi.fn()
  render(<WeldFormField field={FIELD_BY_KEY.get('stamp1KFact')!} draft={{ stamp1KFact: 'OLD-MISSING' }}
    setDraft={setDraft} fieldRefs={{ current: {} }} stampSelectOptions={{ stamp1KFact: [{ value: 'ACTIVE' }] }} />)
  fireEvent.click(screen.getByRole('combobox'))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Пусто' }))
  expect(setDraft).toHaveBeenCalledOnce()
  expect(setDraft.mock.calls[0][0]({ stamp1KFact: 'OLD-MISSING' })).toEqual({ stamp1KFact: null })
})

it.each(stampFields)('%s shows an unregistered stored stamp and allows an explicit clear', fieldKey => {
  function Editor() {
    const [draft, setDraft] = useState<WeldInput>({ [fieldKey]: 'OLD-MISSING' })
    const fieldRefs = useRef<Partial<Record<WeldFieldKey, HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null>>>({})
    return <><WeldFormField field={FIELD_BY_KEY.get(fieldKey)!} draft={draft} setDraft={setDraft} fieldRefs={fieldRefs}
      stampSelectOptions={{ [fieldKey]: [{ value: 'ACTIVE' }, { value: 'ARCHIVE', label: 'ARCHIVE (в архиве)' }] }} />
      <output data-testid="saved-value">{String(draft[fieldKey] ?? 'EMPTY')}</output></>
  }
  render(<Editor />)
  const select = screen.getByRole('combobox', { name: FIELD_BY_KEY.get(fieldKey)!.label })
  expect(select).toHaveValue('OLD-MISSING')
  expect((select as HTMLSelectElement).selectedOptions[0].textContent).toContain('OLD-MISSING')
  fireEvent.click(select)
  const list = screen.getByRole('listbox')
  expect(within(list).getByRole('option', { name: /OLD-MISSING/ })).toHaveAttribute('aria-disabled', 'true')
  expect(within(list).getAllByRole('option').at(-1)).toHaveTextContent('ARCHIVE')
  fireEvent.click(within(list).getByRole('option', { name: 'Пусто' }))
  expect(screen.getByTestId('saved-value')).toHaveTextContent('EMPTY')
  expect(select).toHaveValue('')
})
