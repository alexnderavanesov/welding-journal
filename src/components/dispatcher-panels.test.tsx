import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DispatcherTaskPanel } from '@/components/dispatcher-panels'
import { DispatcherWorkspaceDialog } from '@/components/dispatcher-workspace-dialog'
import {
  DispatcherTaskCard,
  DispatcherTaskGroup,
  type DispatcherTaskCardHandlers,
} from '@/components/dispatcher-task-card'
import type {
  LineConsistencyTask,
  PercentageLineControlTask,
  RepeatedJointCheckTask,
  RepeatedJointTaskGroup,
  WeldRow,
} from '@/lib/dispatcher-types'
import { shouldDeferModalEscape } from '@/lib/use-report-modal-escape-key'

const serverSearch = vi.hoisted(() => vi.fn())
vi.mock('@/server/dispatcher-task-pages', () => ({ searchDispatcherTaskPages: serverSearch }))

describe('DispatcherTaskPanel', () => {
  beforeEach(() => {
    window.localStorage.clear()
    serverSearch.mockReset()
  })

  it('offers an early coil only for an official create task in the welding journal', () => {
    const onCreateEarlyCoil = vi.fn()
    const handlers = {
      ...createHandlers(vi.fn()),
      onCreateEarlyCoil,
      canCreateEarlyCoil: true,
    }
    const task = {
      kind: 'create',
      key: 'create:early-coil',
      row: { id: 51, projectTitle: 'Проект', subtitleCode: 'Шифр', line: 'Линия', joint: 'F51' } as WeldRow,
      sourceJoint: 'F51',
      targetJoint: 'F51R1',
      result: 'ремонт',
      suffix: 'R',
      methodCode: 'ВИК',
    } as const

    const { rerender } = render(<DispatcherTaskCard task={task} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Катушка досрочно' }))
    expect(onCreateEarlyCoil).toHaveBeenCalledWith(task)
    expect(screen.getByRole('button', { name: 'Показать' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Картина' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Цепочка' })).not.toBeInTheDocument()

    rerender(<DispatcherTaskCard task={task} {...handlers} canCreateEarlyCoil={false} />)
    expect(screen.queryByRole('button', { name: 'Катушка досрочно' })).not.toBeInTheDocument()

    rerender(<DispatcherTaskCard task={task} {...handlers} canRunDispatcherMutation={false} />)
    expect(screen.queryByRole('button', { name: 'Создать' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Показать' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Картина' })).toBeInTheDocument()
  })

  it('opens the same officiality workflow from an active chain task', () => {
    const onOpenTaskOfficiality = vi.fn()
    const task = {
      kind: 'create',
      key: 'create:unofficial',
      row: {
        id: 51,
        projectTitle: 'Проект',
        subtitleCode: 'Шифр',
        line: 'Линия',
        joint: 'F51',
        rkResult: 'ремонт',
      } as WeldRow,
      sourceJoint: 'F51',
      targetJoint: 'F51R1',
      result: 'ремонт',
      suffix: 'R',
      methodCode: 'РК',
    } as const

    render(
      <DispatcherTaskCard
        task={task}
        {...createHandlers(vi.fn())}
        onOpenTaskOfficiality={onOpenTaskOfficiality}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Сделать F51 неофициальным' }))
    expect(onOpenTaskOfficiality).toHaveBeenCalledWith(task)
  })

  it('keeps a single task under its DZ heading and restores the panel after collapse', () => {
    const { task, group } = createTaskGroup()
    const onShowTask = vi.fn()
    const onCollapseTaskDetails = vi.fn()
    const onWorkspaceOpenChange = vi.fn()
    const handlers = createHandlers(onShowTask)

    render(
      <StrictMode>
        <DispatcherTaskPanel
          tasks={[task]}
          groups={[group]}
          stickyLeft={0}
          handlers={handlers}
          onCollapseTaskDetails={onCollapseTaskDetails}
          onWorkspaceOpenChange={onWorkspaceOpenChange}
        />
      </StrictMode>,
    )

    expect(screen.getAllByText('1 задача')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'С задачами' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'По объектам' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Диспетчер задач')).not.toHaveClass('max-w-7xl')
    expect(screen.getByLabelText('Диспетчер задач')).toHaveClass('bg-[#eef7fb]/95', 'border-sky-200/80')
    expect(screen.getByLabelText('Диспетчер задач')).toHaveStyle({
      width: '100%',
      maxWidth: 'calc(100vw - 24px)',
    })
    const codeSummary = screen.getByText('ДЗ-27').closest('summary')
    expect(codeSummary).toHaveTextContent('1 задача')
    expect(codeSummary).toHaveTextContent('1 объект')
    expect(screen.queryByText('330-ATM-16-000')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть диспетчер' }))
    expect(onWorkspaceOpenChange).toHaveBeenCalledWith(true)
    const codeDetails = codeSummary?.closest('details')
    if (codeDetails) {
      codeDetails.open = true
      fireEvent(codeDetails, new Event('toggle'))
    }
    expect(screen.getByText('330-ATM-16-000')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Свернуть' }))

    expect(onCollapseTaskDetails).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Развернуть' })).toBeInTheDocument()
    expect(screen.queryByText('330-ATM-16-000')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(screen.getByText('ДЗ-27')).toBeInTheDocument()
  })

  it('shows the exact total without exposing technical pages', () => {
    const { task, group } = createTaskGroup()
    const onLoadMoreTasks = vi.fn()
    render(
      <DispatcherTaskPanel
        tasks={[task]}
        groups={[group]}
        totalTaskCount={12_345}
        hasMoreTasks
        onLoadMoreTasks={onLoadMoreTasks}
        isRefreshing
        stickyLeft={0}
        handlers={createHandlers(vi.fn())}
      />,
    )

    expect(screen.getByText('12345 задач')).toBeInTheDocument()
    expect(screen.getByText('Выполняется фоновый пересчёт…')).toBeInTheDocument()
    expect(screen.queryByText(/Страница 51/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Загрузить ещё задачи (1 из 12345)' })).toBeDisabled()
    expect(onLoadMoreTasks).not.toHaveBeenCalled()
  })

  it('offers retry after a batch request fails', () => {
    const { task, group } = createTaskGroup()
    const onRetryTaskBatch = vi.fn()
    render(
      <DispatcherTaskPanel
        tasks={[task]}
        groups={[group]}
        totalTaskCount={12_345}
        hasMoreTasks
        taskBatchError="Не удалось загрузить задачи"
        onRetryTaskBatch={onRetryTaskBatch}
        stickyLeft={0}
        handlers={createHandlers(vi.fn())}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))
    expect(onRetryTaskBatch).toHaveBeenCalledOnce()
  })

  it('opens an LNK-sized workspace with a task queue, search, and the same task actions', () => {
    const { task, group } = createTaskGroup()
    const onShowTask = vi.fn()
    const onWorkspaceOpenChange = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DispatcherWorkspaceDialog
          tasks={[task]}
          groups={[group]}
          totalTaskCount={1}
          computedRevision={1}
          taskFilterOptions={[]}
          isRefreshing={false}
          hasMoreTasks={false}
          isTaskBatchLoading={false}
          handlers={createHandlers(onShowTask)}
          onClose={() => onWorkspaceOpenChange(false)}
        />
      </QueryClientProvider>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Диспетчер задач' })
    expect(dialog).toHaveClass('max-w-[1480px]')
    const codeOption = within(within(dialog).getByLabelText('Типы ДЗ')).getByRole('button', { name: /ДЗ-27/ })
    expect(codeOption).toHaveTextContent('Проверить назначение контроля линии')
    expect(codeOption).toHaveTextContent('1')
    expect(within(dialog).getByRole('heading', { name: 'Все задачи' })).toBeInTheDocument()
    const queue = within(dialog).getByLabelText('Очередь задач диспетчера')
    expect(within(queue).getByText('Стык или линия')).toBeInTheDocument()
    expect(within(queue).getByText('Задача, причина и действия')).toBeInTheDocument()
    expect(within(queue).getByText('ДЗ-27')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Подробности задачи диспетчера')).not.toBeInTheDocument()
    expect(within(queue).getByText('Назначения контроля различаются.')).toBeInTheDocument()
    expect(within(queue).getByRole('button', { name: 'Показать' })).toBeInTheDocument()
    const location = queue.querySelector('[data-dispatcher-workspace-task-location]') as HTMLElement
    expect(within(location).getByText('Линия')).toBeInTheDocument()
    expect(within(location).getByText('330-ATM-16-000')).toBeInTheDocument()
    expect(location.querySelector('strong')).toHaveTextContent('330-ATM-16-000')
    expect(within(location).getByText('Проект 1')).toBeInTheDocument()
    const subtitleCode = within(location).getByText('Шифр 1')
    expect(subtitleCode).toHaveAttribute('title', 'Шифр 1')
    expect(subtitleCode).toHaveClass('break-words')
    expect(subtitleCode).not.toHaveClass('sm:truncate')
    expect(queue.querySelector('[data-dispatcher-workspace-task-heading] [data-dispatcher-view-actions]')).not.toBeNull()
    expect(queue.querySelector('[data-dispatcher-task-actions] [data-dispatcher-view-actions]')).toBeNull()
    expect(queue.querySelector('[data-dispatcher-workspace-task-details] [data-dispatcher-task-actions]')).not.toBeNull()

    const searchForm = within(dialog).getByRole('search', { name: 'Поиск задач' })
    expect(searchForm).toHaveAttribute('data-expanded', 'false')
    expect(within(dialog).queryByRole('button', { name: 'Найти' })).not.toBeInTheDocument()
    const searchInput = within(dialog).getByRole('textbox', { name: 'Поиск задач диспетчера' })
    fireEvent.focus(searchInput)
    expect(searchForm).toHaveAttribute('data-expanded', 'true')
    fireEvent.change(searchInput, {
      target: { value: 'несуществующий стык' },
    })
    expect(within(dialog).getByRole('heading', { name: 'Все задачи' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Найти' }))
    expect(within(dialog).getByText(/Найдено 0 задач/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Задачи не найдены/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Очистить' }))
    expect(within(dialog).getByRole('textbox', { name: 'Поиск задач диспетчера' })).toHaveFocus()
    fireEvent.blur(searchInput, { relatedTarget: codeOption })
    expect(searchForm).toHaveAttribute('data-expanded', 'false')
    fireEvent.click(codeOption)
    expect(within(dialog).getByRole('heading', { name: 'ДЗ-27 · Проверить назначение контроля линии' })).toBeInTheDocument()
    const selectedQueue = within(dialog).getByLabelText('Очередь задач диспетчера')
    expect(within(selectedQueue).getByText('ДЗ-27')).toBeInTheDocument()
    expect(selectedQueue.querySelector('[data-dispatcher-workspace-task-details]')).toHaveTextContent('Назначения контроля различаются.')
    fireEvent.click(within(selectedQueue).getByRole('button', { name: 'Показать' }))
    expect(onShowTask).toHaveBeenCalledWith(task)
    expect(onWorkspaceOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not request full-index search on each keystroke or focus event', async () => {
    const { task, group } = createTaskGroup()
    serverSearch.mockResolvedValue({ total: 1, tasks: [task] })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DispatcherWorkspaceDialog
          tasks={[task]}
          groups={[group]}
          totalTaskCount={5_001}
          hasMoreTasks
          computedRevision={7}
          taskFilterOptions={[]}
          isRefreshing={false}
          isTaskBatchLoading={false}
          handlers={createHandlers(vi.fn())}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Диспетчер задач' })
    const searchInput = within(dialog).getByRole('textbox', { name: 'Поиск задач диспетчера' })
    fireEvent.focus(searchInput)
    expect(serverSearch).not.toHaveBeenCalled()
    fireEvent.change(searchInput, {
      target: { value: 'F17' },
    })
    expect(serverSearch).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Найти' }))
    await waitFor(() => expect(serverSearch).toHaveBeenCalledOnce())
    expect(serverSearch).toHaveBeenCalledWith({
      data: { search: 'F17', code: null, offset: 0, limit: 100, computedRevision: 7 },
    })
    await waitFor(() => expect(within(dialog).getByText('Назначения контроля различаются.')).toBeInTheDocument())
    expect(serverSearch).toHaveBeenCalledOnce()
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    expect(serverSearch).toHaveBeenCalledOnce()
  })

  it('shows every available correction beside its task without an action menu', () => {
    const percentageTask = createPercentageTask('new-welder', 'Проверить нового сварщика', 2)
    const row = percentageTask.row
    const pstoAction = {
      key: 'psto:26:1:pstoResult:date',
      label: 'Исправить дату ПСТО',
      tone: 'primary' as const,
      target: { kind: 'psto-cycle' as const, rowId: 26, sequence: 1, stage: 'pstoResult' as const, focus: 'date' as const },
    }
    const tvmtAction = {
      key: 'psto:26:1:tvmtResult:date',
      label: 'Исправить дату ТВМТ',
      tone: 'primary' as const,
      target: { kind: 'psto-cycle' as const, rowId: 26, sequence: 1, stage: 'tvmtResult' as const, focus: 'date' as const },
    }
    const checkTask: RepeatedJointCheckTask = {
      kind: 'check',
      key: 'check:psto-date:F26',
      row,
      sourceRow: row,
      sourceJoint: 'F26',
      targetJoint: 'F26',
      baseJoint: 'F26',
      suffix: 'R',
      reason: 'проверить даты ПСТО',
      rootCauseActions: [pstoAction, tvmtAction],
    }
    const tasks = [percentageTask, checkTask]
    const handlers = createHandlers(vi.fn())
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DispatcherWorkspaceDialog
          tasks={tasks}
          groups={[{ key: 'line:F26', baseJoint: 'F26', tasks }]}
          totalTaskCount={2}
          computedRevision={1}
          taskFilterOptions={[]}
          isRefreshing={false}
          hasMoreTasks={false}
          isTaskBatchLoading={false}
          handlers={handlers}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    )

    const queue = screen.getByLabelText('Очередь задач диспетчера')
    const percentageRow = within(queue).getByText('Проверить нового сварщика').closest('[data-dispatcher-workspace-task-row]') as HTMLElement
    expect(within(percentageRow).getByText('Проверить нового сварщика')).toBeInTheDocument()
    expect(within(percentageRow).getByRole('button', { name: 'Исправить клеймо' })).toBeInTheDocument()
    expect(within(percentageRow).getByRole('button', { name: 'Принять' })).toBeInTheDocument()
    const percentageViewActions = percentageRow.querySelector('[data-dispatcher-workspace-task-heading] [data-dispatcher-view-actions]') as HTMLElement
    expect(within(percentageViewActions).getByRole('button', { name: 'Показать' })).toBeInTheDocument()
    expect(within(percentageViewActions).getByRole('button', { name: 'Картина' })).toBeInTheDocument()
    expect(percentageRow.querySelector('[data-dispatcher-workflow-actions]')).not.toHaveTextContent('Показать')
    fireEvent.click(within(percentageViewActions).getByRole('button', { name: 'Картина' }))
    expect(handlers.onOpenTaskPicture).toHaveBeenCalledWith(percentageTask)
    fireEvent.click(within(percentageRow).getByRole('button', { name: 'Исправить клеймо' }))
    expect(handlers.onEditPercentageLineTaskStamp).toHaveBeenCalledWith(percentageTask)

    const checkRow = within(queue).getByText('Проверить даты ПСТО').closest('[data-dispatcher-workspace-task-row]') as HTMLElement
    expect(within(checkRow).getByRole('button', { name: 'Исправить дату ПСТО' })).toBeInTheDocument()
    expect(within(checkRow).getByRole('button', { name: 'Исправить дату ТВМТ' })).toBeInTheDocument()
    const checkViewActions = checkRow.querySelector('[data-dispatcher-workspace-task-heading] [data-dispatcher-view-actions]') as HTMLElement
    expect(within(checkViewActions).getByRole('button', { name: 'Показать' })).toBeInTheDocument()
    expect(within(checkViewActions).getByRole('button', { name: 'Картина' })).toBeInTheDocument()
    fireEvent.click(within(checkRow).getByRole('button', { name: 'Исправить дату ТВМТ' }))
    expect(handlers.onRunTaskAction).toHaveBeenCalledWith(checkTask, expect.objectContaining({
      id: 'open-root-cause',
      rootCauseAction: tvmtAction,
    }))
    expect(within(queue).queryByRole('button', { name: /^(Ещё|Действия|Исправить)$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('renders only visible task rows when the workspace contains thousands of tasks', () => {
    const { task, group } = createTaskGroup()
    const tasks = Array.from({ length: 5_000 }, (_, index) => ({ ...task, key: `${task.key}:${index}` }))
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DispatcherWorkspaceDialog
          tasks={tasks}
          groups={[{ ...group, tasks }]}
          totalTaskCount={5_000}
          computedRevision={1}
          taskFilterOptions={[]}
          isRefreshing={false}
          hasMoreTasks={false}
          isTaskBatchLoading={false}
          handlers={createHandlers(vi.fn())}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    )

    const dialog = container.ownerDocument.querySelector('[role="dialog"][aria-label="Диспетчер задач"]')
    expect(dialog).toHaveTextContent('5000 задач')
    expect(dialog?.querySelectorAll('[data-dispatcher-workspace-task-row]').length).toBeLessThan(30)
    const queue = within(dialog as HTMLElement).getByLabelText('Очередь задач диспетчера')
    expect(queue.querySelectorAll('[data-dispatcher-workspace-task-details]').length).toBeLessThan(30)
    expect(within(queue).getAllByText('Назначения контроля различаются.').length).toBeLessThan(30)
    expect(dialog?.querySelectorAll('[data-dispatcher-workspace-task-row]').length).toBeLessThan(30)
    expect(serverSearch).not.toHaveBeenCalled()
  })

  it('applies the compact default when the active report changes', () => {
    const { task, group } = createTaskGroup()
    const props = {
      tasks: [task],
      groups: [group],
      stickyLeft: 0,
      handlers: createHandlers(vi.fn()),
    }
    const { rerender } = render(
      <DispatcherTaskPanel {...props} defaultExpanded />,
    )

    expect(screen.getByRole('button', { name: 'Свернуть' })).toBeInTheDocument()
    rerender(<DispatcherTaskPanel {...props} defaultExpanded={false} />)

    expect(screen.getByRole('button', { name: 'Развернуть' })).toBeInTheDocument()
    expect(screen.queryByText('330-ATM-16-000')).not.toBeInTheDocument()
  })

  it('returns an expanded DZ to its first ten objects after the whole dispatcher is collapsed', () => {
    const { task } = createTaskGroup()
    const groups = Array.from({ length: 161 }, (_, index) => {
      const groupTask = {
        ...task,
        key: `${task.key}:${index + 1}`,
        line: `Линия ${index + 1}`,
        row: {
          ...task.row,
          id: index + 1,
          line: `Линия ${index + 1}`,
        },
      }
      return {
        key: `object-${index + 1}`,
        baseJoint: `Объект ${index + 1}`,
        tasks: [groupTask],
      } satisfies RepeatedJointTaskGroup
    })

    render(
      <DispatcherTaskPanel
        tasks={groups.flatMap((group) => group.tasks)}
        groups={groups}
        stickyLeft={0}
        handlers={createHandlers(vi.fn())}
      />,
    )

    const details = screen.getByText('ДЗ-27').closest('details')
    if (details) {
      details.open = true
      fireEvent(details, new Event('toggle'))
    }
    expect(screen.getByText('Объект 10')).toBeInTheDocument()
    expect(screen.queryByText('Объект 11')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    expect(screen.getByText('Объект 20')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Свернуть' }))
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))

    const reopened = screen.getByText('ДЗ-27').closest('details')
    if (reopened) {
      reopened.open = true
      fireEvent(reopened, new Event('toggle'))
    }
    expect(screen.getByText('Объект 10')).toBeInTheDocument()
    expect(screen.queryByText('Объект 11')).not.toBeInTheDocument()
    expect(screen.getByText('Показано объектов: 10 из 161')).toBeInTheDocument()
  })

  it('uses expand and collapse as the only panel visibility controls', () => {
    const { task, group } = createTaskGroup()
    render(
      <DispatcherTaskPanel
        tasks={[task]}
        groups={[group]}
        stickyLeft={0}
        handlers={createHandlers(vi.fn())}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Скрыть карточки' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Свернуть' })).toBeInTheDocument()
  })

  it('keeps distinct DZ types visible without the object-grouping switch', () => {
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
      />,
    )

    expect(screen.getByText('ДЗ-02')).toBeInTheDocument()
    expect(screen.getByText('ДЗ-04')).toBeInTheDocument()
    expect(screen.getByText('ДЗ-27')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'По объектам' })).not.toBeInTheDocument()
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
      />,
    )

    const details = screen.getByText('ДЗ-02').closest('details')
    if (details) {
      details.open = true
      fireEvent(details, new Event('toggle'))
    }
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
      />,
    )

    expect(screen.getByText('ДЗ-02')).toBeInTheDocument()
    expect(screen.getAllByText('2 задачи')).toHaveLength(2)
    expect(screen.getByText('2 объекта')).toBeInTheDocument()
    expect(screen.getByText('лишних 6')).toBeInTheDocument()
    expect(screen.queryByText('330-ATM-16-000 · ABC1')).not.toBeInTheDocument()

    const codeGroupSummary = screen.getByText('ДЗ-02').closest('summary')
    expect(codeGroupSummary?.firstElementChild).toHaveClass('w-full')
    expect(codeGroupSummary?.firstElementChild).not.toHaveClass('mx-auto', 'max-w-[1600px]')

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
      />,
    )

    const details = screen.getByText('ДЗ-02').closest('details')
    expect(details).not.toBeNull()
    if (details) {
      details.open = true
      fireEvent(details, new Event('toggle'))
    }

    expect(screen.getByText('Объект 10')).toBeInTheDocument()
    expect(screen.queryByText('Объект 11')).not.toBeInTheDocument()
    expect(screen.getByText('Показано объектов: 10 из 81')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))

    expect(screen.getByText('Объект 20')).toBeInTheDocument()
    expect(screen.queryByText('Объект 21')).not.toBeInTheDocument()
    expect(screen.getByText('Показано объектов: 20 из 81')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Свернуть список' }))

    expect(screen.queryByText('Объект 11')).not.toBeInTheDocument()
    expect(screen.getByText('Показано объектов: 10 из 81')).toBeInTheDocument()
  })

  it('keeps a single object with 1200 tasks in manual bounded batches', () => {
    const { task, group } = createTaskGroup()
    const tasks = Array.from({ length: 1_200 }, (_, index) => ({
      ...task,
      key: `${task.key}:${index + 1}`,
    }))
    const largeGroup = { ...group, tasks }
    const { container } = render(
      <DispatcherTaskGroup group={largeGroup} {...createHandlers(vi.fn())} />,
    )

    const objectLevel = container.querySelector('details[data-dispatcher-hierarchy-level="1"]')
    expect(objectLevel).not.toBeNull()
    if (!(objectLevel instanceof HTMLDetailsElement)) return

    objectLevel.open = true
    fireEvent(objectLevel, new Event('toggle'))

    expect(container.querySelectorAll('[data-dispatcher-task-card]')).toHaveLength(10)
    expect(screen.getByText('Показано задач: 10 из 1200')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    expect(container.querySelectorAll('[data-dispatcher-task-card]')).toHaveLength(20)
    expect(screen.getByText('Показано задач: 20 из 1200')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Свернуть список' }))
    expect(container.querySelectorAll('[data-dispatcher-task-card]')).toHaveLength(10)

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    expect(container.querySelectorAll('[data-dispatcher-task-card]')).toHaveLength(20)

    objectLevel.open = false
    fireEvent(objectLevel, new Event('toggle'))
    objectLevel.open = true
    fireEvent(objectLevel, new Event('toggle'))

    expect(container.querySelectorAll('[data-dispatcher-task-card]')).toHaveLength(10)
    expect(screen.getByText('Показано задач: 10 из 1200')).toBeInTheDocument()
  })

  it('ignores the obsolete saved object-grouping preference', () => {
    const { task, group } = createTaskGroup()
    window.localStorage.setItem('welding-dispatcher-grouping-mode', 'objects')
    render(
      <DispatcherTaskPanel
        tasks={[task]}
        groups={[group]}
        stickyLeft={0}
        handlers={createHandlers(vi.fn())}
      />,
    )

    expect(screen.getByText('ДЗ-27')).toBeInTheDocument()
    expect(screen.queryByText('330-ATM-16-000')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'По объектам' })).not.toBeInTheDocument()
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
    const pictureButton = screen.getByRole('button', { name: 'Картина' })
    expect(pictureButton).toHaveAttribute(
      'title',
      'Открыть картину линии 330-ATM-16-000',
    )
    fireEvent.click(pictureButton)
    expect(handlers.onOpenTaskPicture).toHaveBeenCalledWith(task)
  })

  it('keeps a nested task visually distinct whether its details are open or closed', () => {
    const { task } = createTaskGroup()
    const handlers = {
      ...createHandlers(vi.fn()),
      isTaskExpanded: () => true,
    }
    const { container, rerender } = render(<DispatcherTaskCard task={task} nested {...handlers} />)

    const card = container.querySelector('[data-dispatcher-task-card]')
    const taskToggle = screen.getByTitle('Свернуть описание задачи')
    const taskSummary = container.querySelector('[data-dispatcher-task-summary]')
    const taskToggleIndicator = container.querySelector('[data-dispatcher-task-toggle-indicator]')
    const details = container.querySelector('[data-dispatcher-task-details]')

    expect(card).toHaveAttribute('data-expanded', 'true')
    expect(card).toHaveAttribute('data-dispatcher-hierarchy-level', '2')
    expect(card).toHaveClass('bg-sky-50/70')
    expect(taskSummary).toHaveClass(
      'shadow-[inset_2px_0_0_0_rgb(56_189_248_/_0.72)]',
      'hover:bg-sky-100/60',
    )
    expect(container.querySelector('[data-dispatcher-task-actions]')).not.toHaveClass(
      'bg-sky-50/70',
      'bg-transparent',
    )
    expect(taskToggleIndicator).toHaveAttribute('data-expanded', 'true')
    expect(within(taskToggle).queryByText('330-ATM-16-000')).not.toBeInTheDocument()
    expect(screen.getByText('Что обнаружено')).toBeInTheDocument()
    expect(details).toHaveAttribute('data-dispatcher-hierarchy-level', '3')
    expect(details).toHaveClass('border-t', 'border-sky-100', 'bg-white/75')

    rerender(
      <DispatcherTaskCard
        task={task}
        nested
        {...handlers}
        isTaskExpanded={() => false}
      />,
    )

    expect(container.querySelector('[data-dispatcher-task-summary]')).toHaveClass(
      'shadow-[inset_2px_0_0_0_rgb(56_189_248_/_0.72)]',
      'hover:bg-sky-50/70',
    )
    expect(container.querySelector('[data-dispatcher-task-toggle-indicator]')).toHaveAttribute(
      'data-expanded',
      'false',
    )
    expect(container.querySelector('[data-dispatcher-task-details]')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Показать описание' })).not.toBeInTheDocument()
  })

  it('shows the opened object, task, and details as three visual hierarchy levels', () => {
    const { group } = createTaskGroup()
    const handlers = {
      ...createHandlers(vi.fn()),
      isTaskExpanded: () => true,
    }
    const { container } = render(<DispatcherTaskGroup group={group} {...handlers} />)

    const objectLevel = container.querySelector('details[data-dispatcher-hierarchy-level="1"]')
    expect(objectLevel).toHaveAttribute('data-expanded', 'false')

    if (objectLevel instanceof HTMLDetailsElement) {
      objectLevel.open = true
      fireEvent(objectLevel, new Event('toggle'))
    }

    expect(objectLevel).toHaveAttribute('data-expanded', 'true')
    expect(container.querySelector('[data-dispatcher-object-summary]')).toHaveClass(
      'group-open/object:bg-[#eaf6fb]',
    )
    expect(container.querySelector('[data-dispatcher-hierarchy-children]')).toHaveClass(
      'pl-3',
      'border-t',
      'border-sky-100',
    )
    const taskLevel = container.querySelector('[data-dispatcher-hierarchy-level="2"]')
    const taskSummary = container.querySelector('[data-dispatcher-task-summary]')
    const taskDetails = container.querySelector('[data-dispatcher-hierarchy-level="3"]')
    expect(taskLevel).toBeInTheDocument()
    expect(taskSummary).toHaveClass('shadow-[inset_2px_0_0_0_rgb(56_189_248_/_0.72)]')
    expect(taskDetails).toBeInTheDocument()
    expect(taskDetails).not.toHaveClass('shadow-[inset_2px_0_0_0_rgb(56_189_248_/_0.72)]')
  })

  it('shows report rows and the joint picture as separate direct actions for a joint task', () => {
    const row = {
      id: 44,
      projectTitle: 'Проект 1',
      subtitleCode: 'Шифр 1',
      line: '330-ROOT-01-000',
      joint: 'F44',
    } as WeldRow
    const task: RepeatedJointCheckTask = {
      kind: 'check',
      key: 'check:lnk-date:F44',
      row,
      sourceRow: row,
      sourceJoint: 'F44',
      targetJoint: 'F44',
      baseJoint: 'F44',
      suffix: 'R',
      reason: 'проверить даты ЛНК',
      rootCauseActions: [{
        key: 'lnk:44:primary:ВИК:request:date:0',
        label: 'Исправить дату заявки ВИК',
        tone: 'primary',
        target: {
          kind: 'lnk-control',
          rowId: 44,
          stage: 'primary',
          methodCode: 'ВИК',
          documentPart: 'request',
          focus: 'date',
          documentName: 'Заявка ВИК',
          documentDate: '2026-08-09',
        },
      }],
    }
    const onShowTask = vi.fn()
    const onOpenTaskPicture = vi.fn()

    render(
      <DispatcherTaskCard
        task={task}
        {...createHandlers(onShowTask)}
        onOpenTaskPicture={onOpenTaskPicture}
      />,
    )

    expect(screen.getByRole('button', { name: 'Исправить дату заявки ВИК' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Цепочка' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Показать' }))
    expect(onShowTask).toHaveBeenCalledWith(task)
    expect(onOpenTaskPicture).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Картина' }))
    expect(onOpenTaskPicture).toHaveBeenCalledWith(task)
  })

  it('shows multiple chronology corrections as equal alternatives', () => {
    const row = {
      id: 45,
      projectTitle: 'Проект 1',
      subtitleCode: 'Шифр 1',
      line: '330-ROOT-01-000',
      joint: 'F45',
    } as WeldRow
    const pstoAction = {
      key: 'psto:45:1:pstoResult:date',
      label: 'Исправить дату ПСТО',
      tone: 'primary' as const,
      target: {
        kind: 'psto-cycle' as const,
        rowId: 45,
        sequence: 1,
        stage: 'pstoResult' as const,
        focus: 'date' as const,
      },
    }
    const tvmtAction = {
      key: 'psto:45:1:tvmtResult:date',
      label: 'Исправить дату заключения ТВМТ',
      tone: 'primary' as const,
      target: {
        kind: 'psto-cycle' as const,
        rowId: 45,
        sequence: 1,
        stage: 'tvmtResult' as const,
        focus: 'date' as const,
      },
    }
    const task: RepeatedJointCheckTask = {
      kind: 'check',
      key: 'check:psto-date:F45',
      row,
      sourceRow: row,
      sourceJoint: 'F45',
      targetJoint: 'F45',
      baseJoint: 'F45',
      suffix: 'R',
      reason: 'проверить даты ПСТО',
      rootCauseActions: [pstoAction, tvmtAction],
    }
    const onRunTaskAction = vi.fn()

    render(
      <DispatcherTaskCard
        task={task}
        {...createHandlers(vi.fn())}
        onRunTaskAction={onRunTaskAction}
      />,
    )

    expect(screen.getByRole('button', { name: 'Исправить' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Исправить дату ПСТО' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Исправить дату заключения ТВМТ' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Действия' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Исправить' }))

    expect(screen.getByRole('button', { name: 'Исправить' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu').parentElement).toBe(document.body)
    expect(screen.getByRole('menuitem', { name: 'Исправить дату ПСТО' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Исправить дату заключения ТВМТ' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Исправить дату заключения ТВМТ' }))
    expect(onRunTaskAction).toHaveBeenCalledWith(task, expect.objectContaining({
      id: 'open-root-cause',
      rootCauseAction: tvmtAction,
    }))
  })

  it('closes only the dispatcher action menu on the first Escape', () => {
    const task = createPercentageTask('new-welder', 'Новый сварщик на процентной линии', 2)
    const onOuterEscape = vi.fn()
    const handleOuterEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !shouldDeferModalEscape()) onOuterEscape()
    }

    render(
      <DispatcherTaskCard
        task={task}
        {...createHandlers(vi.fn())}
      />,
    )
    window.addEventListener('keydown', handleOuterEscape, { capture: true })

    try {
      fireEvent.click(screen.getByRole('button', { name: 'Действия' }))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(onOuterEscape).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', handleOuterEscape, { capture: true })
    }
  })

  it('opens the percentage-control assignment workflow from a missing-control task', () => {
    const task = createPercentageTask('missing', 'Назначить контроль', 2)
    const onRunTaskAction = vi.fn()

    render(
      <DispatcherTaskCard
        task={task}
        {...createHandlers(vi.fn())}
        onRunTaskAction={onRunTaskAction}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Назначить контроль' }))

    expect(onRunTaskAction).toHaveBeenCalledWith(task, expect.objectContaining({
      id: 'assign-percentage-controls',
      label: 'Назначить контроль',
    }))
  })

  it('opens the same stamp correction from a new-welder task in the dispatcher', () => {
    const task = createPercentageTask('new-welder', 'Новый сварщик на процентной линии', 2)
    const onEditPercentageLineTaskStamp = vi.fn()

    render(
      <DispatcherTaskCard
        task={task}
        {...createHandlers(vi.fn())}
        onEditPercentageLineTaskStamp={onEditPercentageLineTaskStamp}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Действия' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Исправить клеймо' }))

    expect(onEditPercentageLineTaskStamp).toHaveBeenCalledWith(task)
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
    onOpenTaskPicture: vi.fn(),
    onOpenTaskOfficiality: vi.fn(),
    onCreateTask: vi.fn(),
    onCreateEarlyCoil: vi.fn(),
    onDeleteTask: vi.fn(),
    onRenameTask: vi.fn(),
    onAcceptPercentageLineTask: vi.fn(),
    onEditPercentageLineTaskStamp: vi.fn(),
    onSuspendPercentageLineWelder: vi.fn(),
    onSkipPercentageLineWelderSuspension: vi.fn(),
    onRunTaskAction: vi.fn(),
    canRunDispatcherMutation: true,
    canCreateEarlyCoil: true,
    isCreatePending: false,
    isEarlyCoilPending: false,
    isDeletePending: false,
    isRenamePending: false,
  }
}
