import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  JointDispatcherTasksPanel,
  JointDispatcherTasksSummary,
} from '@/components/joint-dispatcher-tasks-panel'
import { LNK_RESULT_COMPLETENESS_REASON } from '@/lib/dispatcher-check-reasons'
import type { LineConsistencyTask, RepeatedJointCheckTask, WeldRow } from '@/lib/dispatcher-types'

describe('JointDispatcherTasksPanel', () => {
  it('shows a calm empty state for a joint without active dispatcher tasks', () => {
    render(<JointDispatcherTasksPanel row={row()} tasks={[]} onRunAction={vi.fn()} />)

    expect(screen.getByRole('region', { name: 'Требует действия' })).toBeInTheDocument()
    expect(screen.getByText('По этому стыку нет активных СП или ДЗ.')).toBeInTheDocument()
  })

  it('shows the concrete action and routes it with the selected task', () => {
    const current = row()
    const task = checkTask(current)
    const onRunAction = vi.fn()
    render(<JointDispatcherTasksPanel row={current} tasks={[task]} onRunAction={onRunAction} />)

    expect(screen.getByText('ДЗ-32')).toBeInTheDocument()
    expect(screen.getByText('Этот стык')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Исправить в ЛНК' }))

    expect(onRunAction).toHaveBeenCalledWith(current, task, expect.objectContaining({
      id: 'open-lnk',
      label: 'Исправить в ЛНК',
    }))
  })

  it('shows system warnings first with a separate counter and exact recovery action', () => {
    const current = row()
    const dispatcherTask = checkTask(current)
    const systemWarning: RepeatedJointCheckTask = {
      ...checkTask(current),
      key: 'sp-01:1',
      reason: 'Нарушена последовательность контроля.',
      systemWarningCode: 'СП-01',
      rootCauseActions: [{
        key: 'complete-stage:1:beforeHeatTreatment:ВИК:request',
        label: 'Создать заявку НК до ТО',
        tone: 'primary',
        target: {
          kind: 'lnk-control',
          rowId: 1,
          stage: 'beforeHeatTreatment',
          methodCode: 'ВИК',
          documentPart: 'request',
          focus: 'name',
          intent: 'complete-stage',
        },
      }],
    }
    const onRunAction = vi.fn()

    render(
      <JointDispatcherTasksPanel
        row={current}
        tasks={[dispatcherTask, systemWarning]}
        onRunAction={onRunAction}
      />,
    )

    expect(screen.getByText('СП · 1')).toBeInTheDocument()
    expect(screen.getByText('ДЗ · 1')).toBeInTheDocument()
    expect(screen.getAllByText(/^(СП-01|ДЗ-32)$/).map((item) => item.textContent))
      .toEqual(['СП-01', 'ДЗ-32'])

    fireEvent.click(screen.getByRole('button', { name: 'Создать заявку НК до ТО' }))
    expect(onRunAction).toHaveBeenCalledWith(current, systemWarning, expect.objectContaining({
      id: 'open-root-cause',
      label: 'Создать заявку НК до ТО',
    }))
  })

  it('keeps a line-wide task out of the joint list', () => {
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
    render(
      <JointDispatcherTasksPanel
        row={current}
        tasks={[task]}
        fallbackCodes="ДЗ-30"
        onRunAction={vi.fn()}
      />,
    )

    expect(screen.getByText('По этому стыку нет активных СП или ДЗ.')).toBeInTheDocument()
    expect(screen.queryByText('ДЗ-30')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Открыть программу ПСТО' })).not.toBeInTheDocument()
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

    expect(screen.getByText('ДЗ · 2')).toBeInTheDocument()
    expect(screen.getByText('ДЗ-32')).toBeInTheDocument()
    expect(screen.getByText('ДЗ-18')).toBeInTheDocument()
  })

  it('does not present persisted line-scoped codes as joint tasks while the snapshot is unavailable', () => {
    render(
      <JointDispatcherTasksPanel
        row={row()}
        tasks={[]}
        fallbackCodes="ДЗ-01, ДЗ-24, ДЗ-18"
        onRunAction={vi.fn()}
      />,
    )

    expect(screen.getByText('ДЗ-18')).toBeInTheDocument()
    expect(screen.queryByText('ДЗ-01')).not.toBeInTheDocument()
    expect(screen.queryByText('ДЗ-24')).not.toBeInTheDocument()
    expect(screen.getByText('ДЗ · 1')).toBeInTheDocument()
  })

  it('shows every joint task in the dedicated action view', () => {
    const current = row()
    const tasks = Array.from({ length: 4 }, (_, index) => ({
      ...checkTask(current),
      key: `check:lnk-completeness:${index}`,
    }))

    render(<JointDispatcherTasksPanel row={current} tasks={tasks} onRunAction={vi.fn()} />)

    expect(screen.getAllByText('ДЗ-32')).toHaveLength(4)
  })

  it('opens the dedicated action view from the compact summary', () => {
    const current = row()
    const onOpen = vi.fn()

    render(
      <JointDispatcherTasksSummary
        row={current}
        tasks={[checkTask(current)]}
        onOpen={onOpen}
      />,
    )

    expect(screen.getByText('ДЗ: 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть задачи по стыку: 1' }))
    expect(onOpen).toHaveBeenCalledOnce()
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
