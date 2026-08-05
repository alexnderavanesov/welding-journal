import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ContextActionMenu, type ContextActionMenuState } from '@/components/context-action-menu'

describe('ContextActionMenu', () => {
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
})
