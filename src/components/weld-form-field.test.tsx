import { useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WeldFormField } from './weld-form-field'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'

afterEach(cleanup)

const stampFields = ['stamp1K', 'stamp1Z',
  'stamp1KFact', 'stamp1ZFact'] as const

it('keeps the full fractional support length editable only on the original support', () => {
  const field = FIELD_BY_KEY.get('weldLength')!
  const props = { field, draft: { id: 1, joint: 'ОП-1R12', connectionType: 'Т1', weldLength: 600.123456789 },
    setDraft: vi.fn(), fieldRefs: { current: {} }, suggestionRows: [] }
  const { rerender } = render(<WeldFormField {...props} />)
  expect(screen.getByLabelText(field.label)).toHaveAttribute('readonly')
  expect(screen.getByLabelText(field.label)).toHaveValue('600.123456789')
  expect(screen.getByLabelText(field.label)).toHaveAttribute('title', expect.stringContaining('исходного ОП'))
  rerender(<WeldFormField {...props} draft={{ ...props.draft, joint: 'ОП-1' }} />)
  expect(screen.getByLabelText(field.label)).not.toHaveAttribute('readonly')
  fireEvent.change(screen.getByLabelText(field.label), { target: { value: '777.987654321' } })
  expect(props.setDraft).toHaveBeenCalledOnce()
})

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
