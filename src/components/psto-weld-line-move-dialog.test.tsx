import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PstoWeldLineMoveDialog } from '@/components/psto-weld-line-move-dialog'
import type { PstoWeldLineMovePreview } from '@/lib/psto-line-assignment'

const assignedPreview: PstoWeldLineMovePreview = {
  sourceIdentity: { projectTitle: 'Проект', subtitleCode: '400', line: 'L-1' },
  targetIdentity: { projectTitle: 'Проект', subtitleCode: '400', line: 'L-2' },
  targetState: 'assigned',
  requestOnlyCount: 0,
  completedPstoCount: 0,
  preControlCount: 0,
  completedPreControlCount: 0,
  pendingPreControlCount: 0,
  repeatCycleCount: 0,
  row: {
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
  },
}

describe('PstoWeldLineMoveDialog', () => {
  it('defaults to moving the existing primary set to pre-TO when entering a PSTO line', () => {
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
    expect(screen.getByRole('button', { name: /Перенести основной комплект в «До ТО»/ })).toHaveAttribute('aria-pressed', 'true')

    expect(screen.getByText(/Решение выполнится только после сохранения карточки стыка/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Применить решение' }))
    expect(onConfirm).toHaveBeenCalledWith('movePrimaryToBeforeHeatTreatment')
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

    expect(onConfirm).toHaveBeenCalledWith('deletePrimary')
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
        initialDisposition="deletePrimary"
        pending={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /Удалить основной комплект/ })).toHaveAttribute('aria-pressed', 'true')
  })
})
