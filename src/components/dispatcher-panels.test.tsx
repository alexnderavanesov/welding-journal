import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DispatcherTaskPanel } from '@/components/dispatcher-panels'
import { DispatcherTaskCard, type DispatcherTaskCardHandlers } from '@/components/dispatcher-task-card'
import type {
  LineConsistencyTask,
  PercentageLineControlTask,
  RepeatedJointTaskGroup,
  WeldRow,
} from '@/lib/dispatcher-types'

describe('DispatcherTaskPanel', () => {
  it('keeps quick filters available while the task list is collapsed', () => {
    const { task, group } = createTaskGroup()
    const onShowTask = vi.fn()
    const handlers = createHandlers(onShowTask)

    render(
      <DispatcherTaskPanel
        tasks={[task]}
        groups={[group]}
        stickyLeft={0}
        handlers={handlers}
        onDismissAll={vi.fn()}
        columnFilters={{}}
        onColumnFiltersChange={vi.fn()}
      />,
    )

    expect(screen.getAllByText('1 задача')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'С задачами' })).toBeInTheDocument()
    expect(screen.getByLabelText('Диспетчер задач')).toHaveClass('max-w-7xl')
    expect(screen.getByLabelText('Диспетчер задач')).toHaveStyle({ width: 'calc(100vw - 24px)' })
    const groupSummary = screen.getByLabelText('Краткое описание задач 330-ATM-16-000')
    expect(within(groupSummary).getByText('ДЗ-27')).toBeInTheDocument()
    expect(within(groupSummary).getByText(/Проверить назначение контроля линии/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Свернуть' }))

    expect(screen.getByRole('button', { name: 'Развернуть' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'С задачами' })).toBeInTheDocument()
    expect(screen.queryByText('330-ATM-16-000')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(screen.getByText('330-ATM-16-000')).toBeInTheDocument()
  })

  it('shows two task types and folds the remaining types into a counter', () => {
    const { task, group } = createTaskGroup()
    const excessTask = createPercentageTask('excess', 'Проверить лишний контроль', 5)
    const missingTask = createPercentageTask('missing', 'Назначить контроль', 2)
    const tasks = [task, excessTask, missingTask]

    render(
      <DispatcherTaskPanel
        tasks={tasks}
        groups={[{ ...group, tasks }]}
        stickyLeft={0}
        handlers={createHandlers(vi.fn())}
        onDismissAll={vi.fn()}
        columnFilters={{}}
        onColumnFiltersChange={vi.fn()}
      />,
    )

    const groupSummary = screen.getByLabelText('Краткое описание задач 330-ATM-16-000')
    expect(within(groupSummary).getByText('ДЗ-02')).toBeInTheDocument()
    expect(within(groupSummary).getByText(/Лишний контроль/)).toBeInTheDocument()
    expect(within(groupSummary).getByText('ДЗ-04')).toBeInTheDocument()
    expect(within(groupSummary).getByText('+1')).toBeInTheDocument()
    expect(within(groupSummary).queryByText('ДЗ-27')).not.toBeInTheDocument()
  })

  it('shows the key metric for one percentage-line task', () => {
    const task = createPercentageTask('excess', 'Проверить лишний контроль', 5)
    const group: RepeatedJointTaskGroup = {
      key: 'line:330-P49-03-000',
      baseJoint: '330-P49-03-000',
      tasks: [task],
    }

    render(
      <DispatcherTaskPanel
        tasks={[task]}
        groups={[group]}
        stickyLeft={0}
        handlers={createHandlers(vi.fn())}
        onDismissAll={vi.fn()}
        columnFilters={{}}
        onColumnFiltersChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Клеймо ABC1 · лишних 5')).toBeInTheDocument()
  })

  it('uses the task text as the primary navigation action', () => {
    const { task } = createTaskGroup()
    const onShowTask = vi.fn()

    render(<DispatcherTaskCard task={task} {...createHandlers(onShowTask)} />)

    fireEvent.click(screen.getByTitle('Показать связанный стык или цепочку'))

    expect(onShowTask).toHaveBeenCalledWith(task)
  })

  it('shows structured percentage-line indicators in expanded details', () => {
    const task: PercentageLineControlTask = {
      kind: 'percentage-line-control',
      key: 'percentage-line-control:excess:test',
      row: {
        id: 24,
        projectTitle: 'Проект 1',
        subtitleCode: 'Шифр 1',
        line: '330-P49-03-000',
        joint: 'F7',
        weldControlPercent: '10',
      } as WeldRow,
      issue: 'excess',
      projectTitle: 'Проект 1',
      subtitleCode: 'Шифр 1',
      line: '330-P49-03-000',
      stamp: 'ABC1',
      title: 'Проверить лишний контроль процентной линии',
      details: 'По расчету требуется 4 стыка, назначено 9. Лишних обычных "да": 5.',
      requiredControls: 4,
      coveredControls: 4,
      assignedControls: 9,
      count: 5,
    }
    const handlers = {
      ...createHandlers(vi.fn()),
      isTaskExpanded: () => true,
    }

    render(<DispatcherTaskCard task={task} {...handlers} />)

    const indicators = screen.getByLabelText('Показатели задачи')
    expect(within(indicators).getByText('10%')).toBeInTheDocument()
    expect(within(indicators).getByText('ABC1')).toBeInTheDocument()
    expect(within(indicators).getByText('Требуется')).toBeInTheDocument()
    expect(within(indicators).getByText('Назначено')).toBeInTheDocument()
    expect(within(indicators).getByText('Лишних')).toBeInTheDocument()
  })
})

function createTaskGroup() {
  const row: WeldRow = {
    id: 18,
    projectTitle: 'Проект 1',
    subtitleCode: 'Шифр 1',
    line: '330-ATM-16-000',
    joint: 'F18',
  }
  const task: LineConsistencyTask = {
    kind: 'line-consistency',
    key: 'line-control-presence',
    row,
    line: '330-ATM-16-000',
    projectTitle: 'Проект 1',
    subtitleCode: 'Шифр 1',
    fieldKey: 'controlPresence',
    fieldLabel: 'Назначение контроля',
    title: 'Проверить назначение контроля линии',
    values: ['РК', 'УЗК'],
    details: 'Назначения контроля различаются.',
  }
  const group: RepeatedJointTaskGroup = {
    key: 'line:330-ATM-16-000',
    baseJoint: '330-ATM-16-000',
    tasks: [task],
  }
  return { task, group }
}

function createPercentageTask(
  issue: PercentageLineControlTask['issue'],
  title: string,
  count: number,
): PercentageLineControlTask {
  return {
    kind: 'percentage-line-control',
    key: `percentage-line-control:${issue}`,
    row: {
      id: issue === 'excess' ? 25 : 26,
      projectTitle: 'Проект 1',
      subtitleCode: 'Шифр 1',
      line: '330-ATM-16-000',
      joint: issue === 'excess' ? 'F25' : 'F26',
      weldControlPercent: '10',
    } as WeldRow,
    issue,
    projectTitle: 'Проект 1',
    subtitleCode: 'Шифр 1',
    line: '330-ATM-16-000',
    stamp: 'ABC1',
    title,
    details: title,
    requiredControls: 4,
    coveredControls: 4,
    assignedControls: 9,
    count,
  }
}

function createHandlers(onShowTask: DispatcherTaskCardHandlers['onShowTask']): DispatcherTaskCardHandlers {
  return {
    isTaskExpanded: () => false,
    onToggleDetails: vi.fn(),
    onShowTask,
    onOpenTaskOfficiality: vi.fn(),
    onCreateTask: vi.fn(),
    onDeleteTask: vi.fn(),
    onRenameTask: vi.fn(),
    onAcceptPercentageLineTask: vi.fn(),
    onEditPercentageLineTaskStamp: vi.fn(),
    onSuspendPercentageLineWelder: vi.fn(),
    onSkipPercentageLineWelderSuspension: vi.fn(),
    canRunDispatcherMutation: true,
    isCreatePending: false,
    isDeletePending: false,
    isRenamePending: false,
  }
}
