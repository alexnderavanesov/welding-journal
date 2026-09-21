import type { ComponentProps } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { JointChainDialog } from '@/components/joint-chain-dialog'
import { LNK_RESULT_COMPLETENESS_REASON } from '@/lib/dispatcher-check-reasons'
import type {
  PercentageLineControlTask,
  RepeatedJointCheckTask,
  RepeatedJointCreateTask,
  RepeatedJointRenameTask,
  RepeatedJointTask,
  WeldRow,
} from '@/lib/dispatcher-types'
import { buildJointCoilTransitions, type JointCoilTransition } from '@/lib/joint-chain-transitions'

describe('JointChainDialog', () => {
  it('opens editing for the joint currently selected in the picture', () => {
    const rows = [
      row({ id: 1, joint: 'S1' }),
      row({ id: 2, joint: 'S1R1' }),
    ]
    const onEditRow = vi.fn()
    renderDialog({ rows, onEditRow })

    expect(screen.getByRole('button', { name: 'Показать в отчете' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Показать цепочку в отчете' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('S1R1'))
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }))

    expect(onEditRow).toHaveBeenCalledWith(rows[1])
  })

  it('navigates from a completed branch to both coil joints and back through their relations', () => {
    const rows = [
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1R1', rkResult: 'ремонт' }),
      row({ id: 3, joint: 'S1Y1', rkResult: '' }),
      row({ id: 4, joint: 'S1Y2', rkResult: '' }),
    ]
    const transition = buildJointCoilTransitions(rows, {
      earlyCoilDecisionSourceRowIds: new Set([2]),
    })[0]!

    renderDialog({ rows, transitions: [transition] })

    const outgoingPanel = screen.getByRole('region', { name: 'Продолжение цепочки катушкой' })
    expect(screen.getByText('Стык превратился в катушку')).toBeInTheDocument()
    expect(screen.getByText(/по принятому досрочному решению/)).toBeInTheDocument()
    expect(outgoingPanel.parentElement).toHaveClass('mt-auto')
    expect(outgoingPanel).toHaveClass('min-h-[132px]', 'bg-sky-50/60', 'px-3.5', 'py-3')
    fireEvent.click(screen.getByRole('button', { name: 'S1Y1' }))

    expect(screen.getByRole('heading', { name: 'Картина стыка S1Y1' })).toBeInTheDocument()
    expect(screen.getByText('S1Y1 является стыком катушки').closest('aside')).toBeInTheDocument()
    const incomingPanel = screen.getByRole('region', { name: 'Связи стыка катушки' })
    expect(incomingPanel.parentElement).toHaveClass('mt-auto')
    expect(incomingPanel).toHaveClass('min-h-[132px]', 'bg-sky-50/60', 'px-3.5', 'py-3')
    expect(screen.getByRole('button', { name: 'Предыдущий: S1R1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Парный: S1Y2' }))

    expect(screen.getByRole('heading', { name: 'Картина стыка S1Y2' })).toBeInTheDocument()
    expect(screen.getByText('S1Y2 является стыком катушки')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Парный: S1Y1' })).toBeInTheDocument()
  })

  it('offers the approved early-coil action only for a server-confirmed candidate', () => {
    const rows = [row({ id: 1, joint: 'F51', rkResult: 'ремонт' })]
    const onCreateEarlyCoil = vi.fn()
    renderDialog({
      rows,
      earlyCoilCandidates: [{
        replacementJoint: null,
        replacementRowId: null,
        sourceJoint: 'F51',
        sourceRowId: 1,
        targetJoints: ['F51Y1', 'F51Y2'],
      }],
      onCreateEarlyCoil,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Врезать катушку досрочно' }))
    expect(onCreateEarlyCoil).toHaveBeenCalledWith(rows[0], expect.objectContaining({ sourceRowId: 1 }))
  })

  it('names the untouched R/W draft that an early coil will replace', () => {
    const rows = [
      row({ id: 1, joint: 'F18', rkResult: 'вырез' }),
      row({ id: 2, joint: 'F18W1', weldDate: null }),
    ]
    renderDialog({
      record: rows[1],
      rows,
      earlyCoilCandidates: [{
        replacementJoint: 'F18W1',
        replacementRowId: 2,
        sourceJoint: 'F18',
        sourceRowId: 1,
        targetJoints: ['F18Y1', 'F18Y2'],
      }],
    })

    expect(screen.getByText('Заменить пустой F18W1 на катушку')).toBeInTheDocument()
    expect(screen.getByText('Будут созданы F18Y1 и F18Y2 по негодному результату F18.')).toBeInTheDocument()
  })

  it('duplicates only the dispatcher-confirmed R/W continuation for the visible branch', () => {
    const rows = [row({ id: 1, joint: 'F51', rkResult: 'ремонт' })]
    const task: RepeatedJointCreateTask = {
      kind: 'create',
      key: 'create:F51R1',
      row: rows[0]!,
      sourceJoint: 'F51',
      targetJoint: 'F51R1',
      result: 'ремонт',
      suffix: 'R',
      methodCode: 'РК',
    }
    const unrelatedTask: RepeatedJointCreateTask = {
      ...task,
      key: 'create:S9W1',
      row: row({ id: 9, joint: 'S9' }),
      sourceJoint: 'S9',
      targetJoint: 'S9W1',
      result: 'вырез',
      suffix: 'W',
    }
    const onCreateRepeatedJoint = vi.fn()

    renderDialog({
      rows,
      dispatcherTasks: [task, unrelatedTask],
      onCreateRepeatedJoint,
    })

    const actions = screen.getByRole('region', { name: 'Продолжение цепочки стыка' })
    fireEvent.click(within(actions).getByRole('button', { name: 'Создать F51R1' }))
    expect(onCreateRepeatedJoint).toHaveBeenCalledWith(task)
    expect(screen.queryByRole('button', { name: 'Создать S9W1' })).not.toBeInTheDocument()
  })

  it('shows a repair-chain task once in the dedicated action tab', () => {
    const rows = [row({ id: 1, joint: 'F52', rkResult: 'ремонт' })]
    const task: RepeatedJointCreateTask = {
      kind: 'create',
      key: 'create:F52R1',
      row: rows[0]!,
      sourceJoint: 'F52',
      targetJoint: 'F52R1',
      result: 'ремонт',
      suffix: 'R',
      methodCode: 'РК',
    }

    renderDialog({ rows, dispatcherTasks: [task] })
    fireEvent.click(screen.getByRole('tab', { name: 'Требует действия · 1' }))

    expect(screen.queryByRole('region', { name: 'Продолжение цепочки стыка' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Создать F52R1' })).toHaveLength(1)
  })

  it('opens officiality for the rejected source between repeated-joint and early-coil actions', () => {
    const rows = [row({ id: 1, joint: 'F51', rkResult: 'ремонт' })]
    const task: RepeatedJointCreateTask = {
      kind: 'create',
      key: 'create:F51R1',
      row: rows[0]!,
      sourceJoint: 'F51',
      targetJoint: 'F51R1',
      result: 'ремонт',
      suffix: 'R',
      methodCode: 'РК',
    }
    const onOpenOfficiality = vi.fn()

    renderDialog({
      rows,
      dispatcherTasks: [task],
      earlyCoilCandidates: [{
        replacementJoint: null,
        replacementRowId: null,
        sourceJoint: 'F51',
        sourceRowId: 1,
        targetJoints: ['F51Y1', 'F51Y2'],
      }],
      onOpenOfficiality,
    })

    const panel = screen.getByRole('region', { name: 'Продолжение цепочки стыка' })
    expect(within(panel).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Создать F51R1',
      'Сделать F51 неофициальным',
      'Врезать катушку досрочно',
    ])

    fireEvent.click(within(panel).getByRole('button', { name: 'Сделать F51 неофициальным' }))
    expect(onOpenOfficiality).toHaveBeenCalledWith(rows[0], 'unofficial')
  })

  it('does not offer changing an already unofficial source to unofficial again', () => {
    const rows = [row({ id: 1, joint: 'F51', officiality: 'неофициальный', rkResult: 'ремонт' })]
    const task: RepeatedJointCreateTask = {
      kind: 'create',
      key: 'create:F51',
      row: rows[0]!,
      sourceJoint: 'F51',
      targetJoint: 'F51',
      result: 'ремонт',
      suffix: 'R',
      methodCode: 'РК',
    }

    renderDialog({ rows, dispatcherTasks: [task] })

    expect(screen.queryByRole('button', { name: 'Сделать F51 неофициальным' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сделать F51 официальным' })).toBeInTheDocument()
  })

  it('keeps officiality management hidden without an active continuation action', () => {
    const rows = [row({ id: 1, joint: 'F51', rkResult: 'ремонт' })]

    renderDialog({ rows })

    expect(screen.queryByRole('button', { name: 'Сделать F51 неофициальным' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Продолжение цепочки стыка' })).not.toBeInTheDocument()
  })

  it('does not use an early-coil candidate alone as an officiality task', () => {
    const rows = [row({ id: 1, joint: 'F51', rkResult: 'ремонт' })]

    renderDialog({
      rows,
      earlyCoilCandidates: [{
        replacementJoint: null,
        replacementRowId: null,
        sourceJoint: 'F51',
        sourceRowId: 1,
        targetJoints: ['F51Y1', 'F51Y2'],
      }],
    })

    expect(screen.queryByRole('button', { name: 'Сделать F51 неофициальным' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Врезать катушку досрочно' })).toBeInTheDocument()
  })

  it('does not offer officiality for a historical row when another row has the active task', () => {
    const rows = [
      row({ id: 1, joint: 'F51', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'F51R1', rkResult: 'ремонт' }),
    ]
    const task: RepeatedJointCreateTask = {
      kind: 'create',
      key: 'create:F51R2',
      row: rows[1]!,
      sourceJoint: 'F51R1',
      targetJoint: 'F51R2',
      result: 'ремонт',
      suffix: 'R',
      methodCode: 'РК',
    }

    renderDialog({ rows, record: rows[0], dispatcherTasks: [task] })

    expect(screen.queryByRole('button', { name: 'Сделать F51 неофициальным' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать F51R2' })).toBeInTheDocument()
  })

  it('respects a disabled R/W creation capability', () => {
    const rows = [row({ id: 1, joint: 'F51', rkResult: 'ремонт' })]
    const task: RepeatedJointCreateTask = {
      kind: 'create',
      key: 'create:F51R1',
      row: rows[0]!,
      sourceJoint: 'F51',
      targetJoint: 'F51R1',
      result: 'ремонт',
      suffix: 'R',
      methodCode: 'РК',
    }

    renderDialog({ rows, dispatcherTasks: [task], canCreateRepeatedJoint: false })

    const actions = screen.getByRole('region', { name: 'Продолжение цепочки стыка' })
    expect(within(actions).queryByRole('button', { name: 'Создать F51R1' })).not.toBeInTheDocument()
  })

  it('offers the dispatcher-confirmed chain rename in the left chain panel', () => {
    const rows = [
      row({ id: 1, joint: 'S1', rkResult: 'вырез' }),
      row({ id: 2, joint: 'S1R1', rkResult: 'ремонт' }),
      row({ id: 3, joint: 'S1R2' }),
    ]
    const task: RepeatedJointRenameTask = {
      kind: 'rename',
      key: 'rename:S1R1',
      row: rows[1]!,
      sourceRow: rows[0]!,
      sourceJoint: 'S1',
      currentJoint: 'S1R1',
      targetJoint: 'S1W1',
      baseJoint: 'S1',
      changes: [
        { rowId: 2, currentJoint: 'S1R1', targetJoint: 'S1W1' },
        { rowId: 3, currentJoint: 'S1R2', targetJoint: 'S1W1R1' },
      ],
    }
    const onRenameRepeatedJoint = vi.fn()

    renderDialog({ rows, dispatcherTasks: [task], onRenameRepeatedJoint })

    fireEvent.click(screen.getByRole('button', { name: 'Переименовать S1R1 -> S1W1 (+1 далее)' }))
    expect(onRenameRepeatedJoint).toHaveBeenCalledWith(task)
  })

  it('keeps chain renaming read-only outside the welding journal', () => {
    const rows = [row({ id: 2, joint: 'S1R1' })]
    const task = {
      kind: 'rename',
      key: 'rename:S1R1',
      row: rows[0],
      sourceRow: row({ id: 1, joint: 'S1' }),
      sourceJoint: 'S1',
      currentJoint: 'S1R1',
      targetJoint: 'S1W1',
      baseJoint: 'S1',
      changes: [{ rowId: 2, currentJoint: 'S1R1', targetJoint: 'S1W1' }],
    } as RepeatedJointRenameTask

    renderDialog({ rows, dispatcherTasks: [task], canRenameRepeatedJoint: false })

    expect(screen.queryByRole('button', { name: /Переименовать S1R1/ })).not.toBeInTheDocument()
  })

  it('switches to a grouped line picture and runs each task in its own context', () => {
    const rows = [row({ id: 1, joint: 'F47', line: '330-MS-02-000' })]
    const lineTasks = ['9PC6', '9RX9', '9SZN', '9TMP'].map((stamp, index) => percentageTask(
      row({ id: index + 10, joint: `F${50 + index}`, line: '330-MS-02-000' }),
      stamp,
    ))
    const otherLineTask = percentageTask(
      row({ id: 99, joint: 'X1', line: 'OTHER-LINE' }),
      'OTHER',
    )
    const onRunDispatcherTaskAction = vi.fn()
    const onOpenLineInDispatcher = vi.fn()

    renderDialog({
      rows,
      dispatcherTasks: [...lineTasks, otherLineTask],
      onRunDispatcherTaskAction,
      onOpenLineInDispatcher,
    })

    fireEvent.click(screen.getByRole('tab', { name: /Требует действия.*0/ }))
    expect(screen.getByText('По этому стыку нет активных СП или ДЗ.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Картина линии · 4' }))

    expect(screen.getByRole('heading', { name: 'Картина стыка F47' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Линия 330-MS-02-000' })).toBeInTheDocument()
    expect(screen.getByLabelText('4 активные задачи')).toBeInTheDocument()
    expect(screen.getByLabelText('1 тип проблемы')).toBeInTheDocument()
    expect(screen.queryByText('Клеймо OTHER')).not.toBeInTheDocument()
    const group = screen.getByRole('region', { name: 'ДЗ-01 Новый сварщик на процентной линии' })
    expect(within(group).getAllByRole('button', { name: 'Исправить клеймо' })).toHaveLength(3)

    fireEvent.click(within(group).getByRole('button', { name: 'Показать ещё 1' }))
    expect(within(group).getAllByRole('button', { name: 'Исправить клеймо' })).toHaveLength(4)
    fireEvent.click(within(group).getAllByRole('button', { name: 'Исправить клеймо' })[0]!)
    expect(onRunDispatcherTaskAction).toHaveBeenCalledWith(
      lineTasks[0]!.row,
      lineTasks[0],
      expect.objectContaining({ id: 'edit-stamp', label: 'Исправить клеймо' }),
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Стык' }))
    expect(screen.getByRole('heading', { name: 'Картина стыка F47' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Картина линии · 4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Открыть в диспетчере' }))
    expect(onOpenLineInDispatcher).toHaveBeenCalledWith(rows[0])
  })

  it('opens a dispatcher task on the action tab and highlights the requested item', () => {
    const rows = [row({ id: 1, joint: 'F48' })]
    const task: RepeatedJointCheckTask = {
      kind: 'check',
      key: 'check:F48:lnk-completeness',
      row: rows[0]!,
      sourceRow: rows[0]!,
      sourceJoint: 'F48',
      targetJoint: 'F48',
      baseJoint: 'F48',
      suffix: 'R',
      reason: LNK_RESULT_COMPLETENESS_REASON,
      details: 'Не заполнена дата заключения.',
    }

    renderDialog({
      rows,
      dispatcherTasks: [task],
      initialTab: 'actions',
      focusedTaskKey: task.key,
    })

    expect(screen.getByRole('tab', { name: /Требует действия.*1/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('ДЗ-32').closest('[data-highlighted="true"]')).toBeInTheDocument()
  })

  it('opens a line task in the line picture and reveals the highlighted row', () => {
    const rows = [row({ id: 1, joint: 'F49', line: '330-MS-02-000' })]
    const lineTasks = ['9PC6', '9RX9', '9SZN', '9TMP'].map((stamp, index) => percentageTask(
      row({ id: index + 10, joint: `F${60 + index}`, line: '330-MS-02-000' }),
      stamp,
    ))

    renderDialog({
      rows,
      dispatcherTasks: lineTasks,
      initialTab: 'line',
      focusedTaskKey: lineTasks[3]!.key,
    })

    expect(screen.getByRole('tab', { name: 'Картина линии · 4' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('button', { name: 'Исправить клеймо' })).toHaveLength(4)
    expect(screen.getByText('Клеймо 9TMP').closest('[data-highlighted="true"]')).toBeInTheDocument()
  })

  it('switches tabs with the keyboard arrows', () => {
    renderDialog({ rows: [row({ id: 1, joint: 'F50' })] })

    const jointTab = screen.getByRole('tab', { name: 'Стык' })
    fireEvent.keyDown(jointTab, { key: 'ArrowRight' })
    const actionsTab = screen.getByRole('tab', { name: 'Требует действия · 0' })
    expect(actionsTab).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(actionsTab, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Картина линии · 0' })).toHaveAttribute('aria-selected', 'true')
  })
})

function renderDialog({
  record,
  rows,
  transitions = [],
  earlyCoilCandidates = [],
  dispatcherTasks = [],
  canCreateRepeatedJoint = true,
  canRenameRepeatedJoint = true,
  onCreateRepeatedJoint = vi.fn(),
  onRenameRepeatedJoint = vi.fn(),
  onCreateEarlyCoil = vi.fn(),
  onOpenOfficiality = vi.fn(),
  onEditRow = vi.fn(),
  onRunDispatcherTaskAction = vi.fn(),
  onOpenLineInDispatcher = vi.fn(),
  initialTab = 'joint',
  focusedTaskKey = null,
}: {
  record?: WeldRow
  rows: WeldRow[]
  transitions?: JointCoilTransition[]
  dispatcherTasks?: RepeatedJointTask[]
  canCreateRepeatedJoint?: boolean
  canRenameRepeatedJoint?: boolean
  onCreateRepeatedJoint?: (task: RepeatedJointCreateTask) => void
  onRenameRepeatedJoint?: (task: RepeatedJointRenameTask) => void
  earlyCoilCandidates?: Array<{
    replacementJoint: string | null
    replacementRowId: number | null
    sourceJoint: string
    sourceRowId: number
    targetJoints: [string, string]
  }>
  onCreateEarlyCoil?: (row: WeldRow, candidate: {
    replacementJoint: string | null
    replacementRowId: number | null
    sourceJoint: string
    sourceRowId: number
    targetJoints: [string, string]
  }) => void
  onOpenOfficiality?: (row: WeldRow, officiality: 'official' | 'unofficial') => void
  onEditRow?: (row: WeldRow) => void
  onRunDispatcherTaskAction?: ComponentProps<typeof JointChainDialog>['onRunDispatcherTaskAction']
  onOpenLineInDispatcher?: (row: WeldRow) => void
  initialTab?: ComponentProps<typeof JointChainDialog>['initialTab']
  focusedTaskKey?: string | null
}) {
  return render(
    <JointChainDialog
      record={record ?? rows[0]!}
      initialTab={initialTab}
      focusedTaskKey={focusedTaskKey}
      rows={rows}
      transitions={transitions}
      earlyCoilCandidates={earlyCoilCandidates}
      dispatcherTasks={dispatcherTasks}
      errorMessage={null}
      isLoading={false}
      canCreateRepeatedJoint={canCreateRepeatedJoint}
      isRepeatedJointPending={false}
      canRenameRepeatedJoint={canRenameRepeatedJoint}
      isRenameRepeatedJointPending={false}
      canCreateEarlyCoil
      isEarlyCoilPending={false}
      onClose={vi.fn()}
      onOpenBase={vi.fn()}
      onOpenRow={vi.fn()}
      onOpenDocument={vi.fn()}
      onOpenReport={vi.fn()}
      onOpenLineInDispatcher={onOpenLineInDispatcher}
      onEditRow={onEditRow}
      onRunNextAction={vi.fn()}
      onRunDispatcherTaskAction={onRunDispatcherTaskAction}
      onCreateRepeatedJoint={onCreateRepeatedJoint}
      onRenameRepeatedJoint={onRenameRepeatedJoint}
      onCreateEarlyCoil={onCreateEarlyCoil}
      onOpenOfficiality={onOpenOfficiality}
      onRetry={vi.fn()}
    />,
  )
}

function row(values: Partial<WeldRow>): WeldRow {
  return {
    id: values.id ?? 1,
    projectTitle: 'Проект',
    subtitleCode: 'Шифр',
    line: 'Линия',
    joint: values.joint ?? 'S1',
    weldDate: '2026-09-01',
    ...values,
  } as WeldRow
}

function percentageTask(taskRow: WeldRow, stamp: string): PercentageLineControlTask {
  return {
    kind: 'percentage-line-control',
    key: `percentage-line-control:new-welder:${String(taskRow.line)}:${stamp}`,
    row: taskRow,
    issue: 'new-welder',
    projectTitle: String(taskRow.projectTitle),
    subtitleCode: String(taskRow.subtitleCode),
    line: String(taskRow.line),
    stamp,
    title: 'Новый сварщик на процентной линии',
    details: `Новое клеймо ${stamp}.`,
    requiredControls: 1,
    coveredControls: 0,
    assignedControls: 0,
    count: 1,
  }
}
