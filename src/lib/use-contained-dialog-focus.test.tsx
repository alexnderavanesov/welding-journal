import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useLayoutEffect } from 'react'
import { useContainedDialogFocus } from './use-contained-dialog-focus'
import { shouldDeferModalEscape } from './use-report-modal-escape-key'

function Dialog({ label, onClose, busy = false }: { label: string; onClose: () => void; busy?: boolean }) {
  const ref = useContainedDialogFocus(onClose, busy)
  return <section data-modal-dialog="true"><div ref={ref}><button>{label}</button><p>Текст документа</p></div></section>
}

it('owns an immediate Escape before an older report handler can discard its draft', () => {
  const below = vi.fn(), above = vi.fn()
  const reportHandler = () => { if (!shouldDeferModalEscape()) below() }
  window.addEventListener('keydown', reportHandler, true)
  function ImmediateEscape() {
    useLayoutEffect(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) }, [])
    return <Dialog label="Связи документов" onClose={above} />
  }
  try {
    render(<ImmediateEscape />)
    expect(below).not.toHaveBeenCalled()
    expect(above).toHaveBeenCalledOnce()
  } finally { window.removeEventListener('keydown', reportHandler, true) }
})

it('closes the top dialog after focus leaves its controls, without closing the dialog below', () => {
  const below = vi.fn(), above = vi.fn()
  render(<><Dialog label="Заявка" onClose={below} /><Dialog label="Связи документов" onClose={above} /></>)
  const button = screen.getByRole('button', { name: 'Связи документов' })
  button.focus()
  button.blur()
  expect(document.activeElement).toBe(document.body)
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(above).toHaveBeenCalledOnce()
  expect(below).not.toHaveBeenCalled()
})

it('defers to a higher modal even when the old dialog still has keyboard focus', () => {
  const close = vi.fn()
  render(<><Dialog label="Связи документов" onClose={close} /><section data-modal-dialog="true">Другое окно</section></>)
  screen.getByRole('button').focus()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
})

it('keeps a busy dialog open on Escape', () => {
  const close = vi.fn()
  render(<Dialog label="Сохранение" onClose={close} busy />)
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
})
