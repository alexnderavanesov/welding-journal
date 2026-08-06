import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRepeatedJointActionMutations } from '@/lib/use-repeated-joint-action-mutations'

const mocks = vi.hoisted(() => ({
  buildRenamedRepeatedJointRow: vi.fn(),
  buildRepeatedJointRows: vi.fn(),
  createWeldRowsOrThrow: vi.fn(),
  getWeldJointById: vi.fn(),
  invalidateWeldJoints: vi.fn(),
  updateWeldRowOrThrow: vi.fn(),
}))

vi.mock('@/server/welds', () => ({
  deleteWeldJoint: vi.fn(),
  getWeldJointById: mocks.getWeldJointById,
}))

vi.mock('@/lib/weld-journal-mutation-updates', () => ({
  buildRenamedRepeatedJointRow: mocks.buildRenamedRepeatedJointRow,
  buildRepeatedJointRows: mocks.buildRepeatedJointRows,
}))

vi.mock('@/lib/weld-save-utils', () => ({
  createWeldRowsOrThrow: mocks.createWeldRowsOrThrow,
  updateWeldRowOrThrow: mocks.updateWeldRowOrThrow,
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

  it('loads the full weld row before renaming a repeated joint', async () => {
    const fullRow = { id: 21, line: 'LIN-2', joint: 'S2R1', material2: 'отвод 90' }
    const task = {
      kind: 'rename',
      key: 'rename:21',
      row: { id: 21, line: 'LIN-2', joint: 'S2R1' },
      sourceRow: { id: 20, line: 'LIN-2', joint: 'S2' },
      sourceJoint: 'S2',
      currentJoint: 'S2R1',
      targetJoint: 'S2W1',
      baseJoint: 'S2',
    } as const
    mocks.getWeldJointById.mockResolvedValue(fullRow)
    mocks.buildRenamedRepeatedJointRow.mockReturnValue({ ...fullRow, joint: 'S2W1' })
    mocks.updateWeldRowOrThrow.mockResolvedValue({ ...fullRow, joint: 'S2W1' })

    const { result } = renderMutationHook()
    await act(async () => {
      await result.current.renameRepeatedJointMutation.mutateAsync(task)
    })

    expect(mocks.getWeldJointById).toHaveBeenCalledWith({ data: { id: 21 } })
    expect(mocks.buildRenamedRepeatedJointRow).toHaveBeenCalledWith(expect.objectContaining({ row: fullRow }))
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
