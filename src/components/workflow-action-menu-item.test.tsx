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
