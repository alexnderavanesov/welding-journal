import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRepeatedJointActionMutations } from '@/lib/use-repeated-joint-action-mutations'
import type { RepeatedJointRenameTask } from '@/lib/dispatcher-types'

const mocks = vi.hoisted(() => ({
  buildRepeatedJointRows: vi.fn(),
  createEarlyCoilDecision: vi.fn(),
  createWeldRowsOrThrow: vi.fn(),
  getWeldJointById: vi.fn(),
  invalidateWeldJoints: vi.fn(),
  updateSystemWeldRowOrThrow: vi.fn(),
}))

vi.mock('@/server/weld-mutations-api', () => ({
  createEarlyCoilDecision: mocks.createEarlyCoilDecision,
  deleteWeldJoint: vi.fn(),
}))

vi.mock('@/server/weld-read-api', () => ({
  getWeldJointById: mocks.getWeldJointById,
}))

vi.mock('@/lib/weld-journal-mutation-updates', () => ({
  buildRepeatedJointRows: mocks.buildRepeatedJointRows,
}))

vi.mock('@/lib/weld-save-utils', () => ({
  createWeldRowsOrThrow: mocks.createWeldRowsOrThrow,
  updateSystemWeldRowOrThrow: mocks.updateSystemWeldRowOrThrow,
}))

vi.mock('@/lib/weld-query-utils', () => ({
  invalidateWeldJoints: mocks.invalidateWeldJoints,
}))

describe('useRepeatedJointActionMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.invalidateWeldJoints.mockResolvedValue(undefined)
  })

  it('loads the full weld row before creating a repeated joint', async () => {
    const fullRow = { id: 17, line: 'LIN-1', joint: 'S1', material1: 'труба 57' }
    const task = {
      kind: 'create',
      key: 'create:17',
      row: { id: 17, line: 'LIN-1', joint: 'S1' },
      sourceJoint: 'S1',
      targetJoint: 'S1R1',
      methodCode: 'РК',
      result: 'ремонт',
      suffix: 'R',
    } as const
    mocks.getWeldJointById.mockResolvedValue(fullRow)
    mocks.buildRepeatedJointRows.mockReturnValue([{ ...fullRow, id: undefined, joint: 'S1R1' }])
    mocks.createWeldRowsOrThrow.mockResolvedValue([{ id: 18, joint: 'S1R1' }])

    const { result } = renderMutationHook()
    await act(async () => {
      await result.current.repeatedJointMutation.mutateAsync(task)
    })

    expect(mocks.getWeldJointById).toHaveBeenCalledWith({ data: { id: 17 } })
    expect(mocks.buildRepeatedJointRows).toHaveBeenCalledWith(expect.objectContaining({ row: fullRow }))
  })

  it('sends the dispatcher rename task for authoritative server validation', async () => {
    const task: RepeatedJointRenameTask = {
      kind: 'rename',
      key: 'rename:21',
      row: { id: 21, line: 'LIN-2', joint: 'S2R1' },
      sourceRow: { id: 20, line: 'LIN-2', joint: 'S2' },
      sourceJoint: 'S2',
      currentJoint: 'S2R1',
      targetJoint: 'S2W1',
      baseJoint: 'S2',
      changes: [{ rowId: 21, currentJoint: 'S2R1', targetJoint: 'S2W1' }],
    }
    mocks.updateSystemWeldRowOrThrow.mockResolvedValue([{ ...task.row, joint: 'S2W1' }])

    const { result } = renderMutationHook()
    await act(async () => {
      await result.current.renameRepeatedJointMutation.mutateAsync(task)
    })

    expect(mocks.getWeldJointById).not.toHaveBeenCalled()
    expect(mocks.updateSystemWeldRowOrThrow).toHaveBeenCalledWith(task)
  })

  it('uses the atomic server workflow for an early coil and refreshes the chain', async () => {
    mocks.createEarlyCoilDecision.mockResolvedValue({
      createdRows: [{ id: 31, joint: 'S1Y1' }, { id: 32, joint: 'S1Y2' }],
      deletedRowIds: [30],
      decisionKey: 'early-coil:17',
      sourceJoint: 'S1R1',
      targetJoints: ['S1Y1', 'S1Y2'],
    })

    const { result } = renderMutationHook()
    await act(async () => {
      await result.current.earlyCoilMutation.mutateAsync({ sourceRowId: 17 })
    })

    expect(mocks.createEarlyCoilDecision).toHaveBeenCalledWith({ data: { sourceRowId: 17 } })
    expect(mocks.buildRepeatedJointRows).not.toHaveBeenCalled()
    expect(mocks.invalidateWeldJoints).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deleteIds: [30] }),
    )
  })
})

function renderMutationHook() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return renderHook(
    () =>
      useRepeatedJointActionMutations({
        rows: [],
        welderStamps: [],
        welderStampSuspensions: [],
        weldFormStampSelectOptions: {},
        setEditing: vi.fn(),
        setMessage: vi.fn(),
        highlightChangedRows: vi.fn(),
        dismissRepeatedJointTask: vi.fn(),
      }),
    { wrapper },
  )
}
