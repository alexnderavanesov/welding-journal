import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { JointChainDialog } from '@/components/joint-chain-dialog'
import type {
  RepeatedJointCreateTask,
  RepeatedJointRenameTask,
  RepeatedJointTask,
  WeldRow,
} from '@/lib/dispatcher-types'
import { buildJointCoilTransitions, type JointCoilTransition } from '@/lib/joint-chain-transitions'

describe('JointChainDialog', () => {
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
}) {
  return render(
    <JointChainDialog
      record={record ?? rows[0]!}
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
      onRunNextAction={vi.fn()}
      onRunDispatcherTaskAction={vi.fn()}
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
