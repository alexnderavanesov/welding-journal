import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { JointHistoryOverview } from '@/components/joint-history-overview'
import type { RepeatedJointCreateTask, WeldRow } from '@/lib/dispatcher-types'

describe('JointHistoryOverview', () => {
  it('shows and routes the exact dispatcher continuation after a rejected result', () => {
    const row = {
      id: 3,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F3',
      weldDate: '2026-08-01',
      rkResult: 'ремонт',
      finalStatus: 'не годен',
    } as WeldRow
    const task: RepeatedJointCreateTask = {
      kind: 'create',
      key: 'create:F3:F3R1',
      row,
      sourceJoint: 'F3',
      targetJoint: 'F3R1',
      result: 'ремонт',
      suffix: 'R',
      methodCode: 'РК',
    }
    const onRunNextAction = vi.fn()

    render(
      <JointHistoryOverview
        row={row}
        dispatcherTasks={[task]}
        onOpenDocument={vi.fn()}
        onOpenReport={vi.fn()}
        onRunNextAction={onRunNextAction}
      />,
    )

    expect(screen.getByText('Что дальше')).toBeInTheDocument()
    expect(screen.getByText('Создать F3R1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Перейти к созданию/ }))
    expect(onRunNextAction).toHaveBeenCalledWith(row, expect.objectContaining({
      kind: 'dispatcherTask',
      taskKey: task.key,
    }))
  })
})
