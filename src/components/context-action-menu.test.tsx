import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ContextActionMenu, type ContextActionMenuState } from '@/components/context-action-menu'
import { buildWorkflowContextMenuItems } from '@/lib/workflow-context-menu-items'

describe('ContextActionMenu', () => {
  it('can focus the panel without highlighting a command; arrows enter the available commands', () => {
    render(<ContextActionMenu autoFocus="panel" onClose={vi.fn()} menu={{ x: 20, y: 20, items: [
      { id: 'disabled', label: 'Недоступно', disabled: true, onSelect: vi.fn() },
      { id: 'expand', label: 'Развернуть', onSelect: vi.fn() },
      { id: 'all', label: 'Развернуть все', onSelect: vi.fn() },
    ] }} />)
    const panel = screen.getByTestId('context-action-menu')
    expect(panel).toHaveFocus()
    expect(panel.querySelector('button:focus')).toBeNull()
    fireEvent.keyDown(panel, { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: 'Развернуть' })).toHaveFocus()
    panel.focus()
    fireEvent.keyDown(panel, { key: 'ArrowUp' })
    expect(screen.getByRole('button', { name: 'Развернуть все' })).toHaveFocus()
  })
  afterEach(() => {
    document.querySelectorAll('[data-modal-dialog="true"]').forEach((node) => node.remove())
    vi.unstubAllGlobals()
  })

  it.each(['', 'journal-context-menu'])('keeps the actual panel inside the viewport when wrapped text exceeds the estimate (style: %s)', panelClassName => {
    vi.stubGlobal('innerWidth', 1600)
    vi.stubGlobal('innerHeight', 1000)
    // JSDOM has no layout. Model the larger actual content height produced by
    // the two-line disabled reason in the real footer-selection menu.
    const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'context-action-menu' ? 316 : 0
    })
    try {
      render(<ContextActionMenu panelClassName={panelClassName} onClose={vi.fn()} menu={{
        x: 768, y: 990, heading: 'Выбрано стыков: 100', description: 'Линия OFFPAGE-MENU', items: [
          { type: 'label', id: 'navigation-label', label: 'Переходы' },
          { id: 'picture', label: 'Картина стыка', disabled: true,
            description: 'Полная хронология, активные СП/ДЗ и следующий доступный шаг.', onSelect: vi.fn() },
          { id: 'navigate', label: 'Перейти', onSelect: vi.fn() },
          { type: 'separator', id: 'workflow-separator' },
          { id: 'requests', label: 'Заявки', onSelect: vi.fn() },
          { id: 'results', label: 'Результаты и заключения', onSelect: vi.fn() },
          { id: 'extra', label: 'Дополнительно', onSelect: vi.fn() },
        ],
      }} />)
      const panel = screen.getByTestId('context-action-menu')
      const top = Number.parseFloat(panel.style.top)
      expect(top).toBeGreaterThanOrEqual(8)
      expect(top + panel.scrollHeight + 2).toBeLessThanOrEqual(1000 - 8)
    } finally { height.mockRestore() }
  })

  it('ignores unrelated search-input scrolling but closes when the row or page moves', () => {
    const onClose = vi.fn()
    render(<><input aria-label="Поиск" /><div data-testid="row-scroller"><button>Строка</button></div></>)
    const anchor = screen.getByRole('button', { name: 'Строка' })
    const scroller = screen.getByTestId('row-scroller')
    render(<ContextActionMenu menu={{ x: 20, y: 20, anchorElement: anchor,
      items: [{ id: 'edit', label: 'Редактировать', onSelect: vi.fn() }],
    }} onClose={onClose} />)

    // Chromium can reset a long search input's inner scroll after its blur,
    // delivering the event just after the row context menu has opened.
    fireEvent.scroll(screen.getByRole('textbox', { name: 'Поиск' }))
    fireEvent.scroll(scroller) // A queued event without actual row movement.
    expect(onClose).not.toHaveBeenCalled()

    scroller.scrollTop = 20
    fireEvent.scroll(scroller)
    expect(onClose).toHaveBeenCalledTimes(1)
    const previousScrollY = window.scrollY
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 20, writable: true })
    try {
      fireEvent.scroll(window)
      expect(onClose).toHaveBeenCalledTimes(2)
    } finally {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: previousScrollY, writable: true })
    }
    fireEvent(window, new Event('resize'))
    expect(onClose).toHaveBeenCalledTimes(3)
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

  it.each([1200, 390])('keeps navigation behind one button at viewport width %i', (width) => {
    vi.stubGlobal('innerWidth', width)
    const onClose = vi.fn()
    const openLine = vi.fn()
    const openJournal = vi.fn()
    const openPsto = vi.fn()
    render(
      <ContextActionMenu
        menu={{
          x: 20,
          y: 20,
          items: [{
            id: 'navigate',
            label: 'Перейти',
            onSelect: vi.fn(),
            children: [
              { id: 'open-line', label: 'Открыть линию', onSelect: openLine },
              { id: 'open-journal', label: 'Открыть в сварочном журнале (2)', onSelect: openJournal },
              {
                id: 'open-psto', label: 'Открыть в ПСТО (0)', onSelect: openPsto,
                disabled: true, title: 'Среди выбранных стыков нет строк в отчете ПСТО',
              },
            ],
          }],
        }}
        onClose={onClose}
      />,
    )

    const navigate = screen.getByRole('button', { name: 'Перейти' })
    expect(navigate).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('menu')).toHaveClass(width === 390 ? 'hidden' : 'invisible')
    fireEvent.click(navigate)
    expect(navigate).toHaveAttribute('aria-expanded', 'true')
    expect(onClose).not.toHaveBeenCalled()
    expect(openLine).not.toHaveBeenCalled()
    expect(openJournal).not.toHaveBeenCalled()

    const disabled = screen.getByRole('button', { name: 'Открыть в ПСТО (0)' })
    expect(disabled).toBeDisabled()
    expect(screen.getByText('Среди выбранных стыков нет строк в отчете ПСТО')).toBeVisible()
    fireEvent.click(disabled)
    expect(openPsto).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Открыть в сварочном журнале (2)' }))
    expect(openJournal).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(openLine).not.toHaveBeenCalled()
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

  it.each([false, true])('keeps disabled reasons keyboard-accessible (submenu: %s)', nested => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const blocked = { id: 'cut', label: 'вырез', disabled: true, title: 'По ВИК вырез недоступен.', onSelect }
    render(<ContextActionMenu menu={{ x: 20, y: 20, items: nested
      ? [{ id: 'results', label: 'Результат', onSelect: vi.fn(), children: [blocked] }]
      : [blocked] }} onClose={onClose} />)
    if (nested) fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    const explanation = screen.getByRole('group', { name: 'вырез: По ВИК вырез недоступен.' })
    explanation.focus()
    expect(explanation).toHaveFocus()
    fireEvent.keyDown(explanation, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'вырез' }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
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

    // A real pointer enters before clicking; hover must not pre-toggle an inline submenu.
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Заявки' }))
    fireEvent.click(screen.getByRole('button', { name: 'Заявки' }))

    expect(screen.getByRole('button', { name: 'Заявки' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).toHaveClass('relative')
    expect(screen.getByRole('menu')).not.toHaveClass('absolute')
    expect(screen.getByRole('button', { name: 'Новая заявка ПСТО' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Заявки' }))
    expect(screen.getByRole('button', { name: 'Заявки' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('menu')).toHaveClass('hidden')
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
