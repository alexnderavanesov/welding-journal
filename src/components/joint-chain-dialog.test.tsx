import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { JointChainDialog } from '@/components/joint-chain-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { JointCoilTransition } from '@/lib/joint-chain-transitions'

describe('JointChainDialog', () => {
  it('navigates from a completed branch to both coil joints and back through their relations', () => {
    const rows = [
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1R1', rkResult: 'ремонт' }),
      row({ id: 3, joint: 'S1Y1', rkResult: '' }),
      row({ id: 4, joint: 'S1Y2', rkResult: '' }),
    ]
    const transition: JointCoilTransition = {
      key: 'project:code:line:s1',
      parentBranchJoint: 'S1',
      sourceRowId: 2,
      sourceJoint: 'S1R1',
      targetJoints: ['S1Y1', 'S1Y2'],
      targetRowIds: [3, 4],
      mode: 'early-decision',
    }

    renderDialog({ rows, transitions: [transition] })

    expect(screen.getByText('Стык превратился в катушку')).toBeInTheDocument()
    expect(screen.getByText(/по принятому досрочному решению/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'S1Y1' }))

    expect(screen.getByRole('heading', { name: 'Картина стыка S1Y1' })).toBeInTheDocument()
    expect(screen.getByText('S1Y1 является стыком катушки')).toBeInTheDocument()
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
})

function renderDialog({
  rows,
  transitions = [],
  earlyCoilCandidates = [],
  onCreateEarlyCoil = vi.fn(),
}: {
  rows: WeldRow[]
  transitions?: JointCoilTransition[]
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
}) {
  return render(
    <JointChainDialog
      record={rows[0]!}
      rows={rows}
      transitions={transitions}
      earlyCoilCandidates={earlyCoilCandidates}
      dispatcherTasks={[]}
      errorMessage={null}
      isLoading={false}
      canCreateEarlyCoil
      isEarlyCoilPending={false}
      onClose={vi.fn()}
      onOpenBase={vi.fn()}
      onOpenRow={vi.fn()}
      onOpenDocument={vi.fn()}
      onOpenReport={vi.fn()}
      onRunNextAction={vi.fn()}
      onCreateEarlyCoil={onCreateEarlyCoil}
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
