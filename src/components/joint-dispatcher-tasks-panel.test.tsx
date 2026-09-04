import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { JointDispatcherTasksPanel } from '@/components/joint-dispatcher-tasks-panel'
import { LNK_RESULT_COMPLETENESS_REASON } from '@/lib/dispatcher-check-reasons'
import type { LineConsistencyTask, RepeatedJointCheckTask, WeldRow } from '@/lib/dispatcher-types'

describe('JointDispatcherTasksPanel', () => {
  it('stays hidden for a joint without active dispatcher tasks', () => {
    render(<JointDispatcherTasksPanel row={row()} tasks={[]} onRunAction={vi.fn()} />)

    expect(screen.queryByRole('region', { name: 'Активные задачи диспетчера' })).not.toBeInTheDocument()
  })

  it('shows the concrete action and routes it with the selected task', () => {
    const current = row()
    const task = checkTask(current)
    const onRunAction = vi.fn()
    render(<JointDispatcherTasksPanel row={current} tasks={[task]} onRunAction={onRunAction} />)

    expect(screen.getByText('ДЗ-32')).toBeInTheDocument()
    expect(screen.getByText('Этот стык')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Исправить в ЛНК' }))

    expect(onRunAction).toHaveBeenCalledWith(current, task, 'open-lnk')
  })

  it('shows a line-wide task on another row of the same line regardless of letter case', () => {
    const current = row({ id: 8, projectTitle: 'project', subtitleCode: 's1', line: 'lin123' })
    const task: LineConsistencyTask = {
      kind: 'line-consistency',
      key: 'line-psto',
      row: row({ id: 1, projectTitle: 'Project', subtitleCode: 'S1', line: 'Lin123' }),
      projectTitle: 'Project',
      subtitleCode: 'S1',
      line: 'Lin123',
      fieldKey: 'pstoPresence',
      fieldLabel: 'ПСТО',
      title: 'Проверить ПСТО линии',
      values: ['да', 'нет'],
      details: 'Значения различаются.',
    }
    const onRunAction = vi.fn()
    render(<JointDispatcherTasksPanel row={current} tasks={[task]} onRunAction={onRunAction} />)

    expect(screen.getByText('Вся линия')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть программу ПСТО' }))
    expect(onRunAction).toHaveBeenCalledWith(current, task, 'open-psto-program')
  })

  it('does not repeat a task that is already shown as the primary next action', () => {
    const current = row()
    const task = checkTask(current)

    render(
      <JointDispatcherTasksPanel
        row={current}
        tasks={[task]}
        fallbackCodes="ДЗ-32"
        excludedTaskKeys={[task.key]}
        onRunAction={vi.fn()}
      />,
    )

    expect(screen.queryByRole('region', { name: 'Активные задачи диспетчера' })).not.toBeInTheDocument()
  })

  it('keeps fallback codes that are not represented by the current task snapshot', () => {
    const current = row()
    const task = checkTask(current)

    render(
      <JointDispatcherTasksPanel
        row={current}
        tasks={[task]}
        fallbackCodes="ДЗ-32, ДЗ-18"
        onRunAction={vi.fn()}
      />,
    )

    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('ДЗ-32')).toBeInTheDocument()
    expect(screen.getByText('ДЗ-18')).toBeInTheDocument()
  })
})

function checkTask(current: WeldRow): RepeatedJointCheckTask {
  return {
    kind: 'check',
    key: 'check:lnk-completeness',
    row: current,
    sourceRow: current,
    sourceJoint: 'S1',
    targetJoint: 'S1',
    baseJoint: 'S1',
    suffix: 'R',
    reason: LNK_RESULT_COMPLETENESS_REASON,
    details: 'Не заполнена дата заключения.',
  }
}

function row(overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 1,
    projectTitle: 'Проект',
    subtitleCode: 'Шифр',
    line: 'LIN-1',
    joint: 'S1',
    ...overrides,
  }
}
