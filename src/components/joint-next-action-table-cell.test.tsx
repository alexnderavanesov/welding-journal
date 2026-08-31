import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { JointNextActionTableCell } from '@/components/joint-next-action-table-cell'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('JointNextActionTableCell', () => {
  it('runs the same next action that is shown in the joint picture', () => {
    const row = { id: 12, line: '330-D01', joint: 'F12', weldDate: '' } as WeldRow
    const onRun = vi.fn()
    render(
      <JointNextActionTableCell
        row={row}
        dispatcherTasks={[]}
        onRun={onRun}
        onOpenOverview={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('Заполнить сварку F12'))
    expect(onRun).toHaveBeenCalledWith(row, expect.objectContaining({ kind: 'editWeld' }))

    fireEvent.click(screen.getByRole('button', { name: 'Выполнить: Заполнить сварку F12' }))
    expect(onRun).toHaveBeenCalledTimes(2)
    expect(onRun).toHaveBeenLastCalledWith(row, expect.objectContaining({ kind: 'editWeld' }))
  })

  it('opens the joint history from the dedicated info button without running the action', () => {
    const row = { id: 12, line: '330-D01', joint: 'F12', weldDate: '' } as WeldRow
    const onRun = vi.fn()
    const onOpenOverview = vi.fn()
    render(
      <JointNextActionTableCell
        row={row}
        dispatcherTasks={[]}
        onRun={onRun}
        onOpenOverview={onOpenOverview}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Открыть историю и цепочку стыка F12' }))

    expect(onOpenOverview).toHaveBeenCalledWith(row)
    expect(onRun).not.toHaveBeenCalled()
  })

  it('opens the joint picture for a blocked explanatory state', () => {
    const row = { id: 13, line: '330-D01', joint: 'F13', weldDate: '2026-08-31' } as WeldRow
    const onOpenOverview = vi.fn()
    render(
      <JointNextActionTableCell
        row={row}
        dispatcherTasks={[]}
        onRun={vi.fn()}
        onOpenOverview={onOpenOverview}
      />,
    )

    fireEvent.click(screen.getByText('Нужно проверить данные стыка'))
    expect(onOpenOverview).toHaveBeenCalledWith(row)
  })
})
