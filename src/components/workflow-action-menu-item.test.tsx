import { fireEvent, render, screen } from '@testing-library/react'
import { Plus } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { WorkflowActionMenuItem, WorkflowActionScope, type WorkflowAvailability } from '@/components/workflow-action-menu-item'

describe('WorkflowActionMenuItem', () => {
  it('runs only the latest pending action and cancels a pending choice when context changes', () => {
    const first = vi.fn(), second = vi.fn()
    const menu = (context: string, availability: WorkflowAvailability) => <WorkflowActionScope key={context}>
      <WorkflowActionMenuItem label="Первое" icon={Plus} onClick={first} availability={availability} />
      <WorkflowActionMenuItem label="Второе" icon={Plus} onClick={second} availability={availability} />
    </WorkflowActionScope>
    const view = render(menu('one', 'loading'))
    fireEvent.click(screen.getByRole('button', { name: 'Первое' }))
    fireEvent.click(screen.getByRole('button', { name: 'Второе' }))
    view.rerender(menu('one', 'ready'))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
    view.rerender(menu('one', 'loading'))
    fireEvent.click(screen.getByRole('button', { name: 'Первое' }))
    view.rerender(menu('two', 'ready'))
    expect(first).not.toHaveBeenCalled()
  })
  it('shows the reason directly for a disabled action', () => {
    const onClick = vi.fn()
    render(
      <WorkflowActionMenuItem
        label="Внести результат"
        icon={Plus}
        disabled
        disabledReason="Сначала создайте заявку."
        onClick={onClick}
      />,
    )

    expect(screen.getByText('Сначала создайте заявку.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Внести результат' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps an available action compact', () => {
    render(
      <WorkflowActionMenuItem
        label="Новая заявка"
        icon={Plus}
        disabledReason="Не должно отображаться"
        onClick={vi.fn()}
      />,
    )

    expect(screen.queryByText('Не должно отображаться')).not.toBeInTheDocument()
  })
})

it('reserves the same description space through loading, available, blocked and error states', () => {
  const props = { label: 'Результат', icon: Plus, onClick: vi.fn(), description: 'Внести результат заявки.', disabledReason: 'Нет ожидающих заявок.' }
  const { rerender } = render(<WorkflowActionMenuItem {...props} availability="loading" />)
  expect(screen.getByText(props.description)).toHaveClass('h-8')
  expect(screen.queryByText(props.disabledReason)).not.toBeInTheDocument()
  expect(screen.getByRole('button')).toBeEnabled()
  rerender(<WorkflowActionMenuItem {...props} availability="ready" />)
  expect(screen.getByText(props.description)).toHaveClass('h-8')
  expect(screen.getByRole('button')).toBeEnabled()
  rerender(<WorkflowActionMenuItem {...props} disabled availability="ready" />)
  expect(screen.getByText(props.disabledReason)).toHaveClass('h-8')
  rerender(<WorkflowActionMenuItem {...props} availability="error" />)
  expect(screen.getByText(/Не удалось проверить доступность/)).toHaveClass('h-8')
  expect(screen.getByRole('button')).toBeDisabled()
})

it('waits for the current check once, cancels on rejection and never runs after unmount', () => {
  const onClick = vi.fn()
  const props = { label: 'Результат', icon: Plus, onClick, description: 'Внести результат.' }
  const view = render(<WorkflowActionMenuItem {...props} availability="loading" />)
  fireEvent.click(screen.getByRole('button'))
  fireEvent.click(screen.getByRole('button'))
  expect(onClick).not.toHaveBeenCalled()
  view.rerender(<WorkflowActionMenuItem {...props} availability="ready" />)
  expect(onClick).toHaveBeenCalledOnce()
  view.rerender(<WorkflowActionMenuItem {...props} availability="loading" />)
  fireEvent.click(screen.getByRole('button'))
  view.rerender(<WorkflowActionMenuItem {...props} availability="ready" disabled />)
  view.rerender(<WorkflowActionMenuItem {...props} availability="ready" />)
  expect(onClick).toHaveBeenCalledOnce()
  view.rerender(<WorkflowActionMenuItem {...props} availability="loading" />)
  fireEvent.click(screen.getByRole('button'))
  view.unmount()
  render(<WorkflowActionMenuItem {...props} availability="ready" />)
  expect(onClick).toHaveBeenCalledOnce()
})
