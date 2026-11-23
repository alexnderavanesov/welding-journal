import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { SpecialistDialogShell } from './specialist-dialog-shell'

it('keeps initial field focus during StrictMode replay and restores it after closing', async () => {
  const trigger = document.createElement('button')
  document.body.append(trigger); trigger.focus()
  const view = render(<StrictMode><SpecialistDialogShell label="Специалист" busy={false} onClose={vi.fn()}><input autoFocus aria-label="ФИО" /></SpecialistDialogShell></StrictMode>)
  await act(async () => { await Promise.resolve() })
  expect(screen.getByLabelText('ФИО')).toHaveFocus()
  view.unmount()
  await act(async () => { await Promise.resolve() })
  expect(trigger).toHaveFocus()
  trigger.remove()
})
