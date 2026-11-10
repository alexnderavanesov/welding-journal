import { useRef, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useContainedDialogFocus } from '@/lib/use-contained-dialog-focus'
import { LineSchemeNote } from './line-scheme-note'

it('dismisses an annotation note before Escape reaches the drawing without changing its selection or draft', () => {
  const closeDrawing = vi.fn()
  function Drawing() {
    const focus = useContainedDialogFocus(closeDrawing)
    const anchor = useRef<HTMLButtonElement>(null)
    const [shown, setShown] = useState(false)
    return <section data-modal-dialog="true"><div ref={focus}>
      <button ref={anchor} aria-pressed="true" onMouseEnter={() => setShown(true)}>Опора</button>
      <input aria-label="Несохранённое название" defaultValue="Опора 12" />
      {shown && anchor.current && <LineSchemeNote text="Сохранить положение" anchor={anchor.current} onClose={() => setShown(false)} />}
    </div></section>
  }
  render(<Drawing />)
  const marker = screen.getByRole('button', { name: 'Опора' })
  fireEvent.mouseEnter(marker)
  expect(screen.getByRole('tooltip')).toHaveTextContent('Сохранить положение')
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  expect(closeDrawing).not.toHaveBeenCalled()
  expect(marker).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('textbox')).toHaveValue('Опора 12')
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(closeDrawing).toHaveBeenCalledOnce()
})

it('does not block Escape in a higher dialog while its note remains mounted', () => {
  const closeDrawing = vi.fn(), closeHigher = vi.fn(), closeNote = vi.fn()
  function Drawing() {
    const focus = useContainedDialogFocus(closeDrawing)
    const anchor = useRef<HTMLButtonElement>(null)
    const [shown, setShown] = useState(false)
    return <section data-modal-dialog="true"><div ref={focus}>
      <button ref={anchor} onMouseEnter={() => setShown(true)}>Опора</button>
      {shown && anchor.current && <LineSchemeNote text="Примечание" anchor={anchor.current} onClose={closeNote} />}
    </div></section>
  }
  function HigherDialog() {
    const focus = useContainedDialogFocus(closeHigher)
    return <section data-modal-dialog="true"><div ref={focus}>Другое окно</div></section>
  }
  render(<Drawing />)
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Опора' }))
  render(<HigherDialog />)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(closeHigher).toHaveBeenCalledOnce()
  expect(closeDrawing).not.toHaveBeenCalled()
  expect(closeNote).not.toHaveBeenCalled()
})
