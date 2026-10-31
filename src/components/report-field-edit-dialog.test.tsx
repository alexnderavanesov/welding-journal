import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReportFieldEditDialog } from './report-field-edit-dialog'
import { isModalDialogOpen } from '@/lib/modal-layer'

const editing = { record: { id: 1, joint: 'S1' }, fieldKey: 'pstoNote' as const,
  label: 'Примечание ПСТО', kind: 'text' as const, value: '', report: 'heatTreatment' as const }

afterEach(() => document.querySelector('[data-confirm-action-dialog]')?.remove())

it.each(['input', 'button'])('Escape from %s closes the field editor once without clearing the underlying report', target => {
  const clearReport = vi.fn(), close = vi.fn(), save = vi.fn()
  const outerEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !isModalDialogOpen()) clearReport()
  }
  window.addEventListener('keydown', outerEscape)
  function Editor() {
    const [open, setOpen] = useState(true)
    return open ? <ReportFieldEditDialog editing={editing} requestOptions={[]} isSaving={false}
      onChange={() => undefined} onClose={() => { close(); setOpen(false) }} onSave={save} /> : null
  }
  try {
    render(<Editor />)
    const element = target === 'input' ? screen.getByRole('textbox') : screen.getByRole('button', { name: 'Отмена' })
    element.focus()
    fireEvent.keyDown(element, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(close).toHaveBeenCalledTimes(1)
    expect(clearReport).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('keydown', outerEscape)
  }
})

it('leaves Escape to the confirmation above the field editor', () => {
  const close = vi.fn()
  render(<ReportFieldEditDialog editing={editing} requestOptions={[]} isSaving={false}
    onChange={() => undefined} onClose={close} onSave={() => undefined} />)
  const confirmation = document.createElement('div')
  confirmation.dataset.confirmActionDialog = 'true'
  document.body.append(confirmation)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('allows cancelling while context loads, but does not save through Enter', () => {
  const close = vi.fn(), save = vi.fn()
  render(<ReportFieldEditDialog editing={editing} requestOptions={[]} isSaving={false} isContextReady={false}
    onChange={() => undefined} onClose={close} onSave={save} />)
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  expect(save).not.toHaveBeenCalled()
  const cancel = screen.getByRole('button', { name: 'Отмена' })
  expect(cancel).toBeEnabled()
  cancel.focus()
  fireEvent.keyDown(cancel, { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
})

it('blocks duplicate Enter and every close control while an actual write is pending', () => {
  const close = vi.fn(), save = vi.fn()
  render(<ReportFieldEditDialog editing={editing} requestOptions={[]} isSaving isContextReady
    onChange={() => undefined} onClose={close} onSave={save} />)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  fireEvent.keyDown(window, { key: 'Escape' })
  for (const name of ['Сохранить', 'Отмена', 'Закрыть']) expect(screen.getByRole('button', { name })).toBeDisabled()
  expect(save).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})
