import { fireEvent, render, screen } from '@testing-library/react'
import { Plus } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { WorkflowActionMenuItem } from '@/components/workflow-action-menu-item'

describe('WorkflowActionMenuItem', () => {
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
  const { rerender } = render(<WorkflowActionMenuItem {...props} disabled availability="loading" />)
  expect(screen.getByText('Проверяем доступность…')).toHaveClass('h-8')
  expect(screen.queryByText(props.disabledReason)).not.toBeInTheDocument()
  expect(screen.getByRole('button')).toBeDisabled()
  rerender(<WorkflowActionMenuItem {...props} availability="ready" />)
  expect(screen.getByText(props.description)).toHaveClass('h-8')
  expect(screen.getByRole('button')).toBeEnabled()
  rerender(<WorkflowActionMenuItem {...props} disabled availability="ready" />)
  expect(screen.getByText(props.disabledReason)).toHaveClass('h-8')
  rerender(<WorkflowActionMenuItem {...props} availability="error" />)
  expect(screen.getByText(/Не удалось проверить доступность/)).toHaveClass('h-8')
  expect(screen.getByRole('button')).toBeDisabled()
})
