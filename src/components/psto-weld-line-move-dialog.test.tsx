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
    hasConflict: false,
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
  it('defaults to preserving the existing primary set when entering a PSTO line', () => {
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
    expect(screen.getByRole('button', { name: /Сохранить существующий основной НК/ })).toHaveAttribute('aria-pressed', 'true')

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

  it('allows deleting the primary set explicitly without changing the dialog destination', () => {
    const onConfirm = vi.fn()
    render(
      <PstoWeldLineMoveDialog
        preview={assignedPreview}
        pending={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Удалить основной комплект/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Применить решение' }))

    expect(onConfirm).toHaveBeenCalledWith([{ rowId: 7, disposition: 'deletePrimary' }])
  })

  it('keeps the established choices when moving PSTO history to a line without PSTO', () => {
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
    expect(screen.getByRole('button', { name: /Оставить основной комплект/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Перенести завершенный НК до ТО/ })).toBeInTheDocument()
  })

  it('restores the decision already selected in the weld draft', () => {
    render(
      <PstoWeldLineMoveDialog
        preview={assignedPreview}
        initialDecisions={[{ rowId: 7, disposition: 'deletePrimary' }]}
        pending={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /Удалить основной комплект/ })).toHaveAttribute('aria-pressed', 'true')
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

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить перенос цепочки' }))
    expect(onConfirm).toHaveBeenCalledWith([
      { rowId: 7, disposition: 'keepPrimary' },
      { rowId: 8, disposition: 'keepPrimary' },
    ])
  })
})
