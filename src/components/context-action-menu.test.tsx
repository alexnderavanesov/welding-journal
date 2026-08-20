import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ContextActionMenu, type ContextActionMenuState } from '@/components/context-action-menu'

describe('ContextActionMenu', () => {
  afterEach(() => {
    document.querySelectorAll('[data-modal-dialog="true"]').forEach((node) => node.remove())
  })

  it('opens a document submenu without starting its first action', () => {
    const onClose = vi.fn()
    const onGenerate = vi.fn()
    const menu: ContextActionMenuState = {
      x: 20,
      y: 20,
      items: [
        {
          id: 'generate',
          label: 'Сформировать',
          onSelect: vi.fn(),
          children: [
            {
              id: 'generate-jsr',
              label: 'ЖСР',
              onSelect: onGenerate,
            },
          ],
        },
      ],
    }

    render(<ContextActionMenu menu={menu} onClose={onClose} />)

    const generateButton = screen.getByRole('button', { name: 'Сформировать' })
    fireEvent.click(generateButton)

    expect(generateButton).toHaveAttribute('aria-expanded', 'true')
    expect(onGenerate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'ЖСР' }))

    expect(onGenerate).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaves Escape for an open modal instead of closing the background menu', () => {
    const onClose = vi.fn()
    const modal = document.createElement('div')
    modal.dataset.modalDialog = 'true'
    document.body.append(modal)

    render(
      <ContextActionMenu
        menu={{
          x: 20,
          y: 20,
          items: [{ id: 'edit', label: 'Редактировать', onSelect: vi.fn() }],
        }}
        onClose={onClose}
      />,
    )

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows the row identity and non-interactive action group labels', () => {
    render(
      <ContextActionMenu
        menu={{
          x: 20,
          y: 20,
          heading: 'Стык F18',
          description: 'Линия 330-ATM-16-000',
          items: [
            { type: 'label', id: 'navigation', label: 'Переходы' },
            { id: 'open-line', label: 'Открыть линию', onSelect: vi.fn() },
          ],
        }}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Стык F18')).toBeInTheDocument()
    expect(screen.getByText('Линия 330-ATM-16-000')).toBeInTheDocument()
    expect(screen.getByText('Переходы')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Переходы' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Открыть линию' })).toBeInTheDocument()
  })
})
