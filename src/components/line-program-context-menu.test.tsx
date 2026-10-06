import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { useProgramContextMenu } from './line-program-context-menu'

function Harness() {
  const menu = useProgramContextMenu(vi.fn())
  return <div onContextMenu={event => menu.open(event, { id: 1, joint: 'F1', line: 'L1' })}>
    <input aria-label="Текст" /><select aria-label="Назначение"><option>Да</option></select>
    <textarea aria-label="Примечание" /><span contentEditable suppressContentEditableWarning>Редактирование</span>
    <span>Стык F1</span>{menu.menu}
  </div>
}

describe('joint context menu editing boundaries', () => {
  it('ignores queued nested scroll events but closes after a new scroll', () => {
    render(<QueryClientProvider client={new QueryClient()}><Harness /></QueryClientProvider>)
    const joint = screen.getByText('Стык F1'), scroller = joint.parentElement!
    scroller.scrollTop = 105
    fireEvent.contextMenu(joint)
    fireEvent.scroll(scroller)
    fireEvent.scroll(document)
    expect(screen.getByRole('button', { name: 'Перейти к назначениям стыка' })).toBeVisible()
    scroller.scrollTop = 106
    fireEvent.scroll(scroller)
    expect(screen.queryByRole('button', { name: 'Перейти к назначениям стыка' })).not.toBeInTheDocument()
  })

  it('keeps native editing menus and still opens the joint menu outside fields', () => {
    render(<QueryClientProvider client={new QueryClient()}><Harness /></QueryClientProvider>)
    for (const field of [screen.getByLabelText('Текст'), screen.getByLabelText('Назначение'), screen.getByLabelText('Примечание'), screen.getByText('Редактирование')]) {
      expect(fireEvent.contextMenu(field)).toBe(true)
      expect(screen.queryByRole('button', { name: 'Перейти к назначениям стыка' })).not.toBeInTheDocument()
    }
    expect(fireEvent.contextMenu(screen.getByText('Стык F1'))).toBe(false)
    expect(screen.getByRole('button', { name: 'Перейти к назначениям стыка' })).toBeVisible()
  })
})
