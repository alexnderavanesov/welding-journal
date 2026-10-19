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
