import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WorkflowRootCauseNavigation } from '@/components/workflow-root-cause-navigation'

describe('WorkflowRootCauseNavigation', () => {
  it('shows the current correction step and returns to the preserved source window', () => {
    const onReturn = vi.fn()
    render(
      <WorkflowRootCauseNavigation
        actionLabel="Исправить дату ПСТО"
        depth={2}
        onReturn={onReturn}
      />,
    )

    expect(screen.getByText('Шаг исправления 2: Исправить дату ПСТО')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к исходному окну' }))
    expect(onReturn).toHaveBeenCalledOnce()
  })
})
