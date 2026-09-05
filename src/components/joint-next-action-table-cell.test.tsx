import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { JointNextActionTableCell } from '@/components/joint-next-action-table-cell'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('JointNextActionTableCell', () => {
  it('opens the joint picture from the text and runs the shown action only from the arrow', () => {
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

    fireEvent.click(screen.getByText('Заполнить сварку F12'))
    expect(onOpenOverview).toHaveBeenCalledWith(row)
    expect(onRun).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Выполнить: Заполнить сварку F12' }))
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(onRun).toHaveBeenCalledWith(row, expect.objectContaining({ kind: 'editWeld' }))
  })

  it('opens the joint picture from the dedicated info button without running the action', () => {
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

    const pictureButton = screen.getByRole('button', { name: 'Открыть картину стыка F12' })
    expect(pictureButton).toHaveAttribute('title', 'Картина стыка')
    fireEvent.click(pictureButton)

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

  it('opens the joint picture from the cell background without triggering the parent row', () => {
    const row = {
      id: 14,
      joint: 'F14',
      weldDate: '2026-08-31',
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО-14',
      pstoRequestDate: '2026-09-01',
      pstoResult: 'ожидает ПСТО',
    } as WeldRow
    const onRun = vi.fn()
    const onOpenOverview = vi.fn()
    const onEditRow = vi.fn()
    const { container } = render(
      <div onClick={onEditRow}>
        <JointNextActionTableCell
          row={row}
          dispatcherTasks={[]}
          onRun={onRun}
          onOpenOverview={onOpenOverview}
        />
      </div>,
    )

    const cellBackground = container.querySelector('[data-joint-next-action-cell="true"]')
    if (!cellBackground) throw new Error('Next-action cell was not rendered')
    fireEvent.click(cellBackground)

    expect(onOpenOverview).toHaveBeenCalledWith(row)
    expect(onRun).not.toHaveBeenCalled()
    expect(onEditRow).not.toHaveBeenCalled()
  })
})
