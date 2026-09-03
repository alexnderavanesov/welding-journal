import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  RepeatedJointCreateTask,
  RepeatedJointDeleteTask,
  RepeatedJointRenameTask,
  RepeatedJointTask,
} from '@/lib/dispatcher-types'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import { useRepeatedJointTaskActions } from '@/lib/use-repeated-joint-task-actions'

const confirmAction = vi.hoisted(() => vi.fn())

vi.mock('@/lib/confirm-action-context', () => ({
  useConfirmAction: () => confirmAction,
}))

describe('useRepeatedJointTaskActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirmAction.mockResolvedValue(true)
  })

  it.each([
    ['create', createTask(), 'repeatedJointMutation'],
    ['delete', deleteTask(), 'obsoleteRepeatedJointMutation'],
    ['rename', renameTask(), 'renameRepeatedJointMutation'],
  ] as const)(
    'revalidates a %s action against the authoritative dispatcher snapshot',
    async (_kind, task, mutationKey) => {
      const loadTasks = vi.fn<() => Promise<RepeatedJointTask[]>>().mockResolvedValue([task])
      const options = createOptions(loadTasks)
      const { result } = renderHook(() => useRepeatedJointTaskActions(options))

      await act(async () => {
        if (task.kind === 'create') await result.current.createRepeatedJoint(task)
        if (task.kind === 'delete') await result.current.deleteObsoleteRepeatedJoint(task)
        if (task.kind === 'rename') await result.current.renameObsoleteRepeatedJoint(task)
      })

      expect(loadTasks).toHaveBeenCalledTimes(1)
      expect(options[mutationKey].mutate).toHaveBeenCalledWith(task)
    },
  )

  it('does not execute an action that disappeared from the refreshed dispatcher snapshot', async () => {
    const options = createOptions(vi.fn().mockResolvedValue([]))
    const { result } = renderHook(() => useRepeatedJointTaskActions(options))

    await act(async () => {
      await result.current.createRepeatedJoint(createTask())
    })

    expect(options.repeatedJointMutation.mutate).not.toHaveBeenCalled()
    expect(options.setMessage).toHaveBeenCalledWith(
      'Задача уже не актуальна. Плашка обновлена по текущим данным.',
    )
  })

  it('stops safely when the authoritative dispatcher snapshot cannot be refreshed', async () => {
    const options = createOptions(vi.fn().mockRejectedValue(new Error('offline')))
    const { result } = renderHook(() => useRepeatedJointTaskActions(options))

    await act(async () => {
      await result.current.createRepeatedJoint(createTask())
    })

    expect(options.repeatedJointMutation.mutate).not.toHaveBeenCalled()
    expect(options.setMessage).toHaveBeenCalledWith(
      'Не удалось обновить диспетчер для проверки задачи. Повторите действие.',
    )
  })

  it('shows early-coil targets with the configured project suffix', async () => {
    const task = createTask()
    const options = {
      ...createOptions(vi.fn().mockResolvedValue([])),
      systemIndexSettings: {
        ...DEFAULT_SYSTEM_INDEX_SETTINGS,
        coil: 'K',
      },
    }
    const { result } = renderHook(() => useRepeatedJointTaskActions(options))

    await act(async () => {
      await result.current.createEarlyCoil(task)
    })

    expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({
      itemName: 'S1 -> S1K1 + S1K2',
    }))
    expect(options.earlyCoilMutation.mutate).toHaveBeenCalledWith({
      sourceRowId: 1,
      task,
    })
  })

  it('shows every atomic rename in the confirmation before mutating the chain', async () => {
    const task = renameTask()
    task.changes.push({ rowId: 3, currentJoint: 'S1R2', targetJoint: 'S1W1R1' })
    const options = createOptions(vi.fn().mockResolvedValue([task]))
    const { result } = renderHook(() => useRepeatedJointTaskActions(options))

    await act(async () => {
      await result.current.renameObsoleteRepeatedJoint(task)
    })

    expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Исправить имена цепочки',
      description: expect.stringContaining('S1R1 -> S1W1; S1R2 -> S1W1R1'),
      warning: expect.stringContaining('Данные и документы останутся'),
    }))
    expect(options.renameRepeatedJointMutation.mutate).toHaveBeenCalledWith(task)
  })
})

function createOptions(loadTasks: () => Promise<RepeatedJointTask[]>) {
  return {
    activeReport: 'weldingJournal' as const,
    loadTasks,
    systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
    repeatedJointMutation: { mutate: vi.fn() },
    earlyCoilMutation: { mutate: vi.fn() },
    obsoleteRepeatedJointMutation: { mutate: vi.fn() },
    renameRepeatedJointMutation: { mutate: vi.fn() },
    setMessage: vi.fn(),
  }
}

function createTask(): RepeatedJointCreateTask {
  return {
    kind: 'create',
    key: 'create:1',
    row: { id: 1, joint: 'S1' },
    sourceJoint: 'S1',
    targetJoint: 'S1R1',
    result: 'ремонт',
    suffix: 'R',
    methodCode: 'РК',
  } as RepeatedJointCreateTask
}

function deleteTask(): RepeatedJointDeleteTask {
  return {
    kind: 'delete',
    key: 'delete:2',
    row: { id: 2, joint: 'S1R1' },
    sourceRow: { id: 1, joint: 'S1' },
    sourceJoint: 'S1',
    targetJoint: 'S1R1',
    suffix: 'R',
    reason: 'лишний стык',
  } as RepeatedJointDeleteTask
}

function renameTask(): RepeatedJointRenameTask {
  return {
    kind: 'rename',
    key: 'rename:2',
    row: { id: 2, joint: 'S1R1' },
    sourceRow: { id: 1, joint: 'S1' },
    sourceJoint: 'S1',
    currentJoint: 'S1R1',
    targetJoint: 'S1W1',
    baseJoint: 'S1',
    changes: [{ rowId: 2, currentJoint: 'S1R1', targetJoint: 'S1W1' }],
  } as RepeatedJointRenameTask
}
