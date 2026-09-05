import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ContextActionMenu, type ContextActionMenuState } from '@/components/context-action-menu'
import { buildWorkflowContextMenuItems } from '@/lib/workflow-context-menu-items'

describe('ContextActionMenu', () => {
  afterEach(() => {
    document.querySelectorAll('[data-modal-dialog="true"]').forEach((node) => node.remove())
    vi.unstubAllGlobals()
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
    expect(screen.getByRole('menu')).toHaveClass('fixed')
    expect(generateButton.closest('.fixed.inset-0')).toHaveClass('z-[155]')
    expect(screen.getByRole('menu')).toHaveClass('z-[156]')
    expect(screen.getByRole('menu').parentElement).toBe(document.body)
    expect(onGenerate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'ЖСР' }))

    expect(onGenerate).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows compact workflow groups and runs only the selected nested action', () => {
    const onClose = vi.fn()
    const createPstoRequest = vi.fn()
    const createTvmtRequest = vi.fn()

    render(
      <ContextActionMenu
        menu={{
          x: 20,
          y: 20,
          items: buildWorkflowContextMenuItems({
            requests: [
              { id: 'psto-request', label: 'Новая заявка · ПСТО', onSelect: createPstoRequest },
              { id: 'tvmt-request', label: 'Новая заявка · ТВМТ', onSelect: createTvmtRequest },
            ],
            results: [{ id: 'result', label: 'Внести результат · ПСТО', onSelect: vi.fn() }],
            editing: [{ id: 'edit', label: 'ПСТО и ТВМТ этого стыка', onSelect: vi.fn() }],
          }),
        }}
        onClose={onClose}
      />,
    )

    expect(screen.getByRole('button', { name: 'Заявки' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Результаты и заключения' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Редактирование' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Заявки' }))
    fireEvent.click(screen.getByRole('button', { name: 'Новая заявка · ТВМТ' }))

    expect(createPstoRequest).not.toHaveBeenCalled()
    expect(createTvmtRequest).toHaveBeenCalledTimes(1)
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

  it('closes a modal-owned context menu with Escape', () => {
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
        closeOnEscapeWithModal
        onClose={onClose}
      />,
    )

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
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

  it('shows a disabled action reason without relying on a hover tooltip', () => {
    render(
      <ContextActionMenu
        menu={{
          x: 20,
          y: 20,
          items: [{
            id: 'psto-request',
            label: 'Новая заявка ПСТО',
            disabled: true,
            title: 'Сначала завершите НК до ТО.',
            onSelect: vi.fn(),
          }],
        }}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Новая заявка ПСТО' })).toBeDisabled()
    expect(screen.getByText('Сначала завершите НК до ТО.')).toBeVisible()
  })

  it('stacks nested actions inside the menu on a narrow viewport', () => {
    vi.stubGlobal('innerWidth', 390)

    render(
      <ContextActionMenu
        menu={{
          x: 350,
          y: 20,
          items: [{
            id: 'requests',
            label: 'Заявки',
            onSelect: vi.fn(),
            children: [{ id: 'psto-request', label: 'Новая заявка ПСТО', onSelect: vi.fn() }],
          }],
        }}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Заявки' }))

    expect(screen.getByRole('menu')).toHaveClass('relative')
    expect(screen.getByRole('menu')).not.toHaveClass('absolute')
    expect(screen.getByRole('button', { name: 'Новая заявка ПСТО' })).toBeVisible()
  })

  it('moves a submenu upward when it would cross the bottom viewport boundary', () => {
    vi.stubGlobal('innerWidth', 1200)
    vi.stubGlobal('innerHeight', 500)

    render(
      <ContextActionMenu
        menu={{
          x: 100,
          y: 120,
          items: [{
            id: 'results',
            label: 'Результаты и заключения',
            onSelect: vi.fn(),
            children: [
              { id: 'psto-result', label: 'Внести результат ПСТО', onSelect: vi.fn() },
              { id: 'tvmt-result', label: 'Внести результат ТВМТ', onSelect: vi.fn() },
            ],
          }],
        }}
        onClose={vi.fn()}
      />,
    )

    const resultsButton = screen.getByRole('button', { name: 'Результаты и заключения' })
    const anchor = resultsButton.parentElement
    const submenu = screen.getByRole('menu')
    if (!anchor) throw new Error('Submenu anchor is missing')
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 430,
      top: 430,
      right: 420,
      bottom: 466,
      left: 100,
      width: 320,
      height: 36,
      toJSON: () => ({}),
    })
    Object.defineProperty(submenu, 'scrollHeight', { configurable: true, value: 220 })

    fireEvent.mouseEnter(anchor)

    expect(submenu).toHaveStyle({ left: '419px', top: '272px', width: '320px', maxHeight: '484px' })
    expect(submenu).toHaveClass('overflow-y-auto')
  })

  it('keeps a desktop submenu open when it is clicked after opening on hover', () => {
    vi.stubGlobal('innerWidth', 1200)

    render(
      <ContextActionMenu
        menu={{
          x: 100,
          y: 120,
          items: [{
            id: 'results',
            label: 'Результаты и заключения',
            onSelect: vi.fn(),
            children: [{ id: 'result', label: 'Внести результат', onSelect: vi.fn() }],
          }],
        }}
        onClose={vi.fn()}
      />,
    )

    const resultsButton = screen.getByRole('button', { name: 'Результаты и заключения' })
    const anchor = resultsButton.parentElement
    if (!anchor) throw new Error('Submenu anchor is missing')

    fireEvent.mouseEnter(anchor)
    fireEvent.click(resultsButton)

    expect(resultsButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).toHaveClass('visible')
  })

  it('does not close a long submenu while the user scrolls inside it', () => {
    vi.stubGlobal('innerWidth', 1200)
    const onClose = vi.fn()

    render(
      <ContextActionMenu
        menu={{
          x: 100,
          y: 120,
          items: [{
            id: 'results',
            label: 'Результаты и заключения',
            onSelect: vi.fn(),
            children: [{ id: 'result', label: 'Внести результат', onSelect: vi.fn() }],
          }],
        }}
        onClose={onClose}
      />,
    )

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Результаты и заключения' }).parentElement!)
    fireEvent.scroll(screen.getByRole('menu'))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toHaveClass('visible')
  })
})
