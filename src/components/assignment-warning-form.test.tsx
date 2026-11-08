import { useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { WeldFormField } from './weld-form-field'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { normalizeAssignmentWarningSettings } from '@/lib/assignment-warnings'
import { applyRemoteAssignmentWarningSettings } from '@/lib/assignment-warning-settings'
import { userStorage } from '@/lib/user-storage'

beforeEach(() => {
  const settings = normalizeAssignmentWarningSettings(null)
  settings.uzk.thresholds = { С: 8, У: 10, Т: 12 }
  settings.uzk.text = 'Настроенный текст УЗК'
  applyRemoteAssignmentWarningSettings(settings)
})
afterEach(() => { cleanup(); userStorage.removeItem('welding-assignment-warnings') })

function Form({ field = 'hasUzk', initial = {} }: { field?: 'hasUzk' | 'hasRk'; initial?: WeldInput }) {
  const [draft, setDraft] = useState<WeldInput>({ connectionType: 'С17', d1: '6', weldingJournalNote: 'Сохранить заметку', ...initial })
  const refs = useRef<Partial<Record<WeldFieldKey, HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null>>>({})
  return <div data-testid="joint-card">
    <WeldFormField field={FIELD_BY_KEY.get(field)!} draft={draft} setDraft={setDraft} fieldRefs={refs} suggestionRows={[]} />
    <button onClick={() => setDraft(row => ({ ...row, d1: '8', weldingJournalNote: 'Другая заметка' }))}>Изменить диаметр</button>
    <output data-testid="draft">{JSON.stringify(draft)}</output>
  </div>
}

it.each(['Да, назначить', 'Нет, оставить пусто'])('keeps the card and unrelated edits when answering %s', answer => {
  render(<Form />)
  fireEvent.click(screen.getByRole('button', { name: 'Да' }))
  const dialog = screen.getByRole('dialog', { name: 'Подтвердить назначение контроля' })
  expect(dialog).toHaveTextContent('Настроенный текст УЗК')
  expect(dialog).toHaveTextContent('6 мм ≤ 8 мм')
  fireEvent.click(within(dialog).getByRole('button', { name: answer }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByTestId('joint-card')).toBeInTheDocument()
  const draft = JSON.parse(screen.getByTestId('draft').textContent!)
  expect(draft.hasUzk).toBe(answer === 'Да, назначить' ? true : null)
  expect(draft.weldingJournalNote).toBe('Сохранить заметку')
})

it('refreshes memoized diameter inputs, warns at equality, and clears on Escape', () => {
  render(<Form initial={{ d1: '20' }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Изменить диаметр' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Да' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('8 мм ≤ 8 мм')
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(JSON.parse(screen.getByTestId('draft').textContent!).hasUzk).toBeNull()
})

it('does not prompt when the switch is off and prompts for additional RK on U', () => {
  const config = normalizeAssignmentWarningSettings(null); config.rk.enabled = false
  applyRemoteAssignmentWarningSettings(config)
  const view = render(<Form field="hasRk" initial={{ connectionType: 'У19' }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Да' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(JSON.parse(screen.getByTestId('draft').textContent!).hasRk).toBe(true)
  config.rk.enabled = true; applyRemoteAssignmentWarningSettings(config)
  fireEvent.click(screen.getByRole('button', { name: 'Дополнительный' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Пусто' }))
  fireEvent.click(screen.getByRole('button', { name: 'Дополнительный' }))
  fireEvent.click(screen.getByRole('button', { name: 'Нет, оставить пусто' }))
  expect(JSON.parse(screen.getByTestId('draft').textContent!).hasRk).toBeNull()
  view.unmount()
})
