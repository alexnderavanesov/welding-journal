import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PstoWeldLineMoveDialog } from '@/components/psto-weld-line-move-dialog'
import type {
  PstoWeldLineMovePreview,
  PstoWeldLineMovePreviewRow,
} from '@/lib/psto-line-assignment'

const assignedRow: PstoWeldLineMovePreviewRow = {
    rowId: 7,
    joint: 'F7',
    spool: 'S1',
    preMethods: [],
    promotablePreMethods: [],
    pendingPreMethods: [],
    primaryMethods: ['ВИК', 'РК'],
    pstoRequest: '',
    pstoResult: '',
    repeatCycleCount: 0,
    preservesPerformedHistory: false,
    blocksActivation: true,
    activationTransferBlockedMethods: [],
    requiresDisposition: true,
}

const assignedPreview: PstoWeldLineMovePreview = {
  sourceIdentity: { projectTitle: 'Проект', subtitleCode: '400', line: 'L-1' },
  targetIdentity: { projectTitle: 'Проект', subtitleCode: '400', line: 'L-2' },
  targetState: 'assigned',
  rootRowId: 7,
  rootJoint: 'F7',
  isChainMove: false,
  expectedRowIds: [7],
  expectedVersions: [{ id: 7, version: '107' }],
  requestOnlyCount: 0,
  completedPstoCount: 0,
  preControlCount: 0,
  completedPreControlCount: 0,
  pendingPreControlCount: 0,
  repeatCycleCount: 0,
  rows: [assignedRow],
  row: assignedRow,
}

describe('PstoWeldLineMoveDialog', () => {
  it('requires a deliberate choice before moving retained history and cancellation writes nothing', () => {
    const onConfirm = vi.fn(), onClose = vi.fn()
    const row = { ...assignedRow, primaryMethods: [], preMethods: ['ВИК' as const], pendingPreMethods: ['ВИК' as const] }
    render(<PstoWeldLineMoveDialog preview={{ ...assignedPreview, targetState: 'unassigned', row, rows: [row] }} pending={false} onClose={onClose} onConfirm={onConfirm} />)
    expect(screen.getByRole('button', { name: 'Применить решение' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Перенести НК «До ТО» в основной/ })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к форме' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })
  it.each(['assigned', 'unassigned'] as const)('explains officiality protection for transfer into %s and rejects a stale selection', targetState => {
    const reason = 'Сначала верните стыку официальность'
    const row = { ...assignedRow, promotablePreMethods: ['ВИК' as const], activationTransferBlockedReason: reason, promotionBlockedReason: reason }
    const disposition = targetState === 'assigned' ? 'movePrimaryToBeforeHeatTreatment' as const : 'promoteBeforeHeatTreatment' as const
    const onConfirm = vi.fn()
    render(<PstoWeldLineMoveDialog preview={{ ...assignedPreview, targetState, row, rows: [row] }}
      initialDecisions={[{ rowId: row.rowId, disposition }]} pending={false} onClose={vi.fn()} onConfirm={onConfirm} />)
    expect(screen.getByText(reason)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: targetState === 'assigned' ? /Перенести основной комплект/ : /Перенести НК «До ТО»/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Применить решение' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: targetState === 'assigned' ? /Сохранить существующий основной НК/ : /Изменить только линию/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Применить решение' }))
    expect(onConfirm).toHaveBeenCalledWith([{ rowId: row.rowId, disposition: 'keepPrimary' }])
  })
  it('requires an explicit choice also when entering a PSTO line', () => {
    const onConfirm = vi.fn()
    render(
      <PstoWeldLineMoveDialog
        preview={assignedPreview}
        pending={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Перенос стыка на линию с ПСТО' })).toBeInTheDocument()
    expect(screen.getByText('Найден основной комплект: ВИК, РК')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Сохранить существующий основной НК/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Применить решение' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Сохранить существующий основной НК/ }))

    expect(screen.getByText(/Решение выполнится только после сохранения карточки стыка/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Применить решение' }))
    expect(onConfirm).toHaveBeenCalledWith([{ rowId: 7, disposition: 'keepPrimary' }])
  })

  it('still allows moving a misclassified primary set to pre-TO explicitly', () => {
    const onConfirm = vi.fn()
    render(
      <PstoWeldLineMoveDialog
        preview={assignedPreview}
        pending={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Перенести основной комплект в «До ТО»/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Применить решение' }))

    expect(onConfirm).toHaveBeenCalledWith([{ rowId: 7, disposition: 'movePrimaryToBeforeHeatTreatment' }])
  })

  it('does not offer document deletion as a side effect of changing the line', () => {
    const onConfirm = vi.fn()
    render(
      <PstoWeldLineMoveDialog
        preview={assignedPreview}
        pending={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.queryByRole('button', { name: /Удалить основной комплект/ })).not.toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('offers history preservation or whole-package transfer without deleting documents', () => {
    render(
      <PstoWeldLineMoveDialog
        preview={{
          ...assignedPreview,
          targetState: 'unassigned',
          row: {
            ...assignedPreview.row,
            preMethods: ['ВИК'],
            promotablePreMethods: ['ВИК'],
          },
          rows: [{
            ...assignedPreview.row,
            preMethods: ['ВИК'],
            promotablePreMethods: ['ВИК'],
          }],
        }}
        pending={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Перенос стыка на линию без ПСТО' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Изменить только линию/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Перенести НК «До ТО»/ })).toBeInTheDocument()
  })

  it('restores the decision already selected in the weld draft', () => {
    render(
      <PstoWeldLineMoveDialog
        preview={assignedPreview}
        initialDecisions={[{ rowId: 7, disposition: 'movePrimaryToBeforeHeatTreatment' }]}
        pending={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /Перенести основной комплект/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows every chain row and confirms one decision per row', () => {
    const onConfirm = vi.fn()
    const coilRow: PstoWeldLineMovePreviewRow = {
      ...assignedRow,
      rowId: 8,
      joint: 'F7Y1',
      primaryMethods: [],
      blocksActivation: false,
      requiresDisposition: false,
    }
    render(
      <PstoWeldLineMoveDialog
        preview={{
          ...assignedPreview,
          isChainMove: true,
          expectedRowIds: [7, 8],
          expectedVersions: [{ id: 7, version: '107' }, { id: 8, version: '108' }],
          rows: [assignedRow, coilRow],
        }}
        pending={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Перенос цепочки F7' })).toBeInTheDocument()
    expect(screen.getByText(/F7, F7Y1/)).toBeInTheDocument()
    expect(screen.getByText('Перенос без дополнительного решения')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Подтвердить перенос цепочки' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Сохранить существующий основной НК/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить перенос цепочки' }))
    expect(onConfirm).toHaveBeenCalledWith([
      { rowId: 7, disposition: 'keepPrimary' },
      { rowId: 8, disposition: 'keepPrimary' },
    ])
  })
})
