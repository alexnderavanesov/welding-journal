import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DispatcherTaskPanel } from '@/components/dispatcher-panels'
import { DispatcherTaskCard, type DispatcherTaskCardHandlers } from '@/components/dispatcher-task-card'
import type {
  LineConsistencyTask,
  PercentageLineControlTask,
  RepeatedJointTaskGroup,
  WeldRow,
} from '@/lib/dispatcher-types'

describe('DispatcherTaskPanel', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

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

    fireEvent.click(screen.getByRole('button', { name: 'По объектам' }))

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

  it('groups repeated task codes and keeps their object rows available', () => {
    const firstTask = createPercentageTask('excess', 'Проверить лишний контроль', 5)
    const secondTask = {
      ...createPercentageTask('excess', 'Проверить лишний контроль', 1),
      key: 'percentage-line-control:excess:second',
      line: '330-P52-06-000',
      row: {
        ...createPercentageTask('excess', 'Проверить лишний контроль', 1).row,
        id: 27,
        line: '330-P52-06-000',
      },
    }
    const groups: RepeatedJointTaskGroup[] = [
      {
        key: 'line:330-ATM-16-000:ABC1',
        baseJoint: '330-ATM-16-000 · ABC1',
        tasks: [firstTask],
      },
      {
        key: 'line:330-P52-06-000:ABC1',
        baseJoint: '330-P52-06-000 · ABC1',
        tasks: [secondTask],
      },
    ]

    render(
      <DispatcherTaskPanel
        tasks={[firstTask, secondTask]}
        groups={groups}
        stickyLeft={0}
        handlers={createHandlers(vi.fn())}
        onDismissAll={vi.fn()}
        columnFilters={{}}
        onColumnFiltersChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'По ДЗ' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('ДЗ-02')).toBeInTheDocument()
    expect(screen.getAllByText('2 задачи')).toHaveLength(2)
    expect(screen.getByText('2 объекта')).toBeInTheDocument()
    expect(screen.getByText('лишних 6')).toBeInTheDocument()
    expect(screen.queryByText('330-ATM-16-000 · ABC1')).not.toBeInTheDocument()

    const details = screen.getByText('ДЗ-02').closest('details')
    expect(details).not.toBeNull()
    if (details) {
      details.open = true
      fireEvent(details, new Event('toggle'))
    }

    expect(screen.getByText('330-ATM-16-000 · ABC1')).toBeInTheDocument()
    expect(screen.getByText('330-P52-06-000 · ABC1')).toBeInTheDocument()
  })

  it('reveals a large code group in bounded batches', () => {
    const groups = Array.from({ length: 81 }, (_, index) => {
      const task = {
        ...createPercentageTask('excess', 'Проверить лишний контроль', 1),
        key: `percentage-line-control:excess:${index + 1}`,
      }
      return {
        key: `object-${index + 1}`,
        baseJoint: `Объект ${index + 1}`,
        tasks: [task],
      } satisfies RepeatedJointTaskGroup
    })

    render(
      <DispatcherTaskPanel
        tasks={groups.flatMap((group) => group.tasks)}
        groups={groups}
        stickyLeft={0}
        handlers={createHandlers(vi.fn())}
        onDismissAll={vi.fn()}
        columnFilters={{}}
        onColumnFiltersChange={vi.fn()}
      />,
    )

    const details = screen.getByText('ДЗ-02').closest('details')
    expect(details).not.toBeNull()
    if (details) {
      details.open = true
      fireEvent(details, new Event('toggle'))
    }

    expect(screen.getByText('Объект 80')).toBeInTheDocument()
    expect(screen.queryByText('Объект 81')).not.toBeInTheDocument()
    expect(screen.getByText('Показано объектов: 80 из 81')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))

    expect(screen.getByText('Объект 81')).toBeInTheDocument()
    expect(screen.queryByText('Показано объектов: 80 из 81')).not.toBeInTheDocument()
  })

  it('switches back to object grouping and remembers the choice', () => {
    const { task, group } = createTaskGroup()
    const view = render(
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

    fireEvent.click(screen.getByRole('button', { name: 'По объектам' }))
    expect(window.localStorage.getItem('welding-dispatcher-grouping-mode')).toBe('objects')
    view.unmount()

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

    expect(screen.getByRole('button', { name: 'По объектам' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens the task description from its text and keeps navigation on the separate action', () => {
    const { task } = createTaskGroup()
    const onShowTask = vi.fn()
    const onToggleDetails = vi.fn()
    const handlers = createHandlers(onShowTask)

    render(<DispatcherTaskCard task={task} {...handlers} onToggleDetails={onToggleDetails} />)

    fireEvent.click(screen.getByTitle('Открыть описание задачи'))

    expect(onToggleDetails).toHaveBeenCalledWith(task)
    expect(onShowTask).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Показать' }))
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
