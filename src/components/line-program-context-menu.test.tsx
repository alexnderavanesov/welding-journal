import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { useProgramContextMenu } from './line-program-context-menu'
import { ProgramReadOnlyTable } from './line-program-assignment-table'

vi.mock('@/server/welder-stamps', () => ({
  loadWelderStampRegistrySnapshot: () => new Promise<never>(() => {}),
}))

function Harness() {
  const menu = useProgramContextMenu(vi.fn())
  return <div onContextMenu={event => menu.open(event, { id: 1, joint: 'F1', line: 'L1' })}>
    <input aria-label="Текст" /><select aria-label="Назначение"><option>Да</option></select>
    <textarea aria-label="Примечание" /><span contentEditable suppressContentEditableWarning>Редактирование</span>
    <span>Стык F1</span>{menu.menu}
  </div>
}

function PreviewHarness({ onAssignments }: { onAssignments: (id: number) => void }) {
  const menu = useProgramContextMenu(onAssignments)
  return <>
    <ProgramReadOnlyTable
      rows={[{ id: 1, joint: 'F1', line: 'L1', vikConclusion: 'ВИК-1', vikConclusionDate: '2026-10-03' }]}
      onAssignment={onAssignments}
      onContextMenu={menu.open}
    />
    {menu.menu}
  </>
}

describe('joint context menu editing boundaries', () => {
  it('keeps a portalled document preview separate from its joint menu and restores the document link focus', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const onAssignments = vi.fn()
    const { unmount } = render(<QueryClientProvider client={client}><PreviewHarness onAssignments={onAssignments} /></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'F1' }))
    const link = screen.getByRole('button', { name: 'ВИК-1' })
    link.focus()
    fireEvent.click(link)
    expect(screen.getByRole('dialog', { name: 'Предпросмотр документа' })).toBeVisible()
    expect(fireEvent.contextMenu(screen.getByRole('heading', { name: 'Предпросмотр документа' }))).toBe(true)
    expect(screen.queryByRole('button', { name: 'Перейти к назначениям стыка' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Закрыть предпросмотр' }), { key: 'F10', shiftKey: true })
    expect(screen.queryByRole('button', { name: 'Перейти к назначениям стыка' })).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Предпросмотр документа' })).not.toBeInTheDocument()
    expect(link).toHaveFocus()

    expect(fireEvent.contextMenu(link)).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Перейти к назначениям стыка' }))
    expect(onAssignments).toHaveBeenCalledExactlyOnceWith(1)
    unmount()
    client.clear()
  })

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
