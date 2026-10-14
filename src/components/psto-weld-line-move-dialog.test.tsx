import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PstoWeldLineMoveDialog } from '@/components/psto-weld-line-move-dialog'
import type { WeldDraft } from '@/lib/dispatcher-types'
import { useHomeWeldEditorController } from '@/lib/use-home-weld-editor-controller'
import { getPstoWeldLineMovePreview } from '@/server/weld-line-operations'
import type {
  PstoWeldLineMovePreview,
  PstoWeldLineMovePreviewRow,
} from '@/lib/psto-line-assignment'

vi.mock('@/server/weld-line-operations', () => ({ getPstoWeldLineMovePreview: vi.fn() }))
// The shared confirmation hook has its own query/acknowledgment tests.
vi.mock('@/components/specialist-transfer-confirmation', () => ({ useSpecialistTransferConfirmation: () => ({ ready: true, notice: null, confirmation: undefined }) }))

const assignedRow: PstoWeldLineMovePreviewRow = {
    rowId: 7,
    joint: 'F7',
    spool: 'S1',
    preMethods: [],
    completedPreMethods: [],
    pendingPreMethods: [],
    primaryMethods: ['ВИК', 'РК'],
    pstoRequest: '',
    pstoResult: '',
    repeatCycleCount: 0,
    preservesPerformedHistory: false,
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

const preToRow: PstoWeldLineMovePreviewRow = {
  ...assignedRow,
  primaryMethods: [],
  preMethods: ['ВИК', 'РК'],
  completedPreMethods: ['ВИК'],
  pendingPreMethods: ['РК'],
  stageCorrection: { targetStage: 'primary', disabledReason: null },
}
const correctionPreview: PstoWeldLineMovePreview = {
  ...assignedPreview, targetState: 'unassigned', rows: [preToRow], row: preToRow, preControlCount: 1,
}

describe('PstoWeldLineMoveDialog', () => {
  it.each(['assigned', 'unassigned', 'cancelled'] as const)('confirms a move to %s without a transfer choice when no correction metadata is present', targetState => {
    const onConfirm = vi.fn(), onClose = vi.fn()
    render(<PstoWeldLineMoveDialog preview={{ ...assignedPreview, targetState }} pending={false} onClose={onClose} onConfirm={onConfirm} />)
    expect(screen.queryByRole('button', { name: /Перенести.*НК|Оставить основной|Удалить/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByText(/НК до ТО остаётся НК до ТО/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить перенос' }))
    expect(onConfirm).toHaveBeenCalledWith([{ rowId: 7, disposition: 'keepPrimary' }])
  })

  it('cancellation sends nothing and saving cannot be dismissed', () => {
    const onConfirm = vi.fn(), onClose = vi.fn()
    const view = render(<PstoWeldLineMoveDialog preview={assignedPreview} pending={false} onClose={onClose} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к форме' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
    view.rerender(<PstoWeldLineMoveDialog preview={assignedPreview} pending onClose={onClose} onConfirm={onConfirm} />)
    expect(screen.getByRole('button', { name: 'Подтвердить перенос' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeDisabled()
  })

  it('confirms all chain members with the same preservation rule', () => {
    const onConfirm = vi.fn(), second = { ...assignedRow, rowId: 8, joint: 'F7R' }
    render(<PstoWeldLineMoveDialog preview={{ ...assignedPreview, isChainMove: true, rows: [assignedRow, second] }} pending={false} onClose={vi.fn()} onConfirm={onConfirm} />)
    expect(screen.getByText('F7R')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить перенос цепочки' }))
    expect(onConfirm).toHaveBeenCalledWith([{ rowId: 7, disposition: 'keepPrimary' }, { rowId: 8, disposition: 'keepPrimary' }])
  })

  it.each(['unassigned', 'cancelled'] as const)('keeps pre-TO by default when moving to %s even if correction is available', targetState => {
    const onConfirm = vi.fn()
    render(<PstoWeldLineMoveDialog preview={{ ...correctionPreview, targetState }} pending={false} onClose={vi.fn()} onConfirm={onConfirm} />)
    expect(screen.getByRole('radio', { name: 'Оставить НК до ТО' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Весь НК до ТО → основной' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('перенос НК в основной — 0 · сохранить этапы — 1')
    expect(screen.getByText(/Все методы, заявки, результаты и заключения переносятся вместе, с исходными датами и названиями/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить перенос' }))
    expect(onConfirm).toHaveBeenCalledWith([{ rowId: 7, disposition: 'keepPrimary' }])
  })

  it.each(['unassigned', 'cancelled'] as const)('selects an entire pre-TO package per chain member when moving to %s', targetState => {
    const onConfirm = vi.fn()
    const second = { ...preToRow, rowId: 8, joint: 'F7R' }
    const third = { ...assignedRow, rowId: 9, joint: 'F7R2' }
    render(<PstoWeldLineMoveDialog preview={{ ...correctionPreview, targetState, isChainMove: true, rows: [preToRow, second, third] }} pending={false} onClose={vi.fn()} onConfirm={onConfirm} />)
    fireEvent.click(within(screen.getByRole('group', { name: 'Этап НК для стыка F7R' })).getByRole('radio', { name: 'Весь НК до ТО → основной' }))
    expect(within(screen.getByRole('group', { name: 'Этап НК для стыка F7' })).getByRole('radio', { name: 'Оставить НК до ТО' })).toBeChecked()
    expect(screen.queryByRole('group', { name: 'Этап НК для стыка F7R2' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('перенос НК в основной — 1 · сохранить этапы — 2')
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить перенос цепочки' }))
    expect(onConfirm).toHaveBeenCalledWith([
      { rowId: 7, disposition: 'keepPrimary' },
      { rowId: 8, disposition: 'movePreHeatTreatmentToPrimary' },
      { rowId: 9, disposition: 'keepPrimary' },
    ])
  })

  it.each(['Основной НК уже заполнен.', 'Нарушена хронология контроля.', 'На НК до ТО опирается заявка ПСТО.'])('explains a blocked correction: %s', disabledReason => {
    const onConfirm = vi.fn()
    const row = { ...preToRow, stageCorrection: { targetStage: 'primary' as const, disabledReason } }
    render(<PstoWeldLineMoveDialog preview={{ ...correctionPreview, rows: [row], row }} pending={false} onClose={vi.fn()} onConfirm={onConfirm} />)
    const transfer = screen.getByRole('radio', { name: 'Весь НК до ТО → основной' })
    expect(transfer).toBeDisabled()
    expect(transfer).toHaveAccessibleDescription(`Перенос недоступен: ${disabledReason}`)
    fireEvent.click(transfer)
    expect(screen.getByRole('radio', { name: 'Оставить НК до ТО' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить перенос' }))
    expect(onConfirm).toHaveBeenCalledWith([{ rowId: 7, disposition: 'keepPrimary' }])
  })

  it.each(['primary', 'beforeHeatTreatment'] as const)('offers only the correct direction into an assigned target (%s metadata)', targetStage => {
    const onConfirm = vi.fn()
    const row = { ...preToRow, stageCorrection: { targetStage, disabledReason: null } }
    render(<PstoWeldLineMoveDialog preview={{ ...assignedPreview, rows: [row], row }} pending={false} onClose={vi.fn()} onConfirm={onConfirm} />)
    if (targetStage === 'primary') expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    else {
      expect(screen.getByRole('radio', { name: 'Оставить основной НК' })).toBeChecked()
      fireEvent.click(screen.getByRole('radio', { name: 'Весь основной НК → до ТО' }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить перенос' }))
    expect(onConfirm).toHaveBeenCalledWith([{ rowId: 7, disposition: targetStage === 'primary' ? 'keepPrimary' : 'movePrimaryToPreHeatTreatment' }])
  })

  it('drops a selected correction when a refreshed preview blocks it', () => {
    const onConfirm = vi.fn()
    const view = render(<PstoWeldLineMoveDialog preview={correctionPreview} pending={false} onClose={vi.fn()} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Весь НК до ТО → основной' }))
    const row = { ...preToRow, stageCorrection: { targetStage: 'primary' as const, disabledReason: 'Данные изменились: основной НК уже заполнен.' } }
    view.rerender(<PstoWeldLineMoveDialog preview={{ ...correctionPreview, rows: [row], row }} pending={false} onClose={vi.fn()} onConfirm={onConfirm} />)
    expect(screen.getByRole('radio', { name: 'Оставить НК до ТО' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Весь НК до ТО → основной' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('перенос НК в основной — 0')
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить перенос' }))
    expect(onConfirm).toHaveBeenCalledWith([{ rowId: 7, disposition: 'keepPrimary' }])
  })

  it('restores the confirmed choice when reopening the same transfer for inspection', () => {
    const onConfirm = vi.fn()
    render(<PstoWeldLineMoveDialog preview={correctionPreview}
      initialDecisions={[{ rowId: 7, disposition: 'movePreHeatTreatmentToPrimary' }]}
      pending={false} onClose={vi.fn()} onConfirm={onConfirm} />)
    expect(screen.getByRole('radio', { name: 'Весь НК до ТО → основной' })).toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent('перенос НК в основной — 1')
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить перенос' }))
    expect(onConfirm).toHaveBeenCalledWith([{ rowId: 7, disposition: 'movePreHeatTreatmentToPrimary' }])
  })

  it('does not restore a previous correction when the refreshed data now forbids it', () => {
    const onConfirm = vi.fn()
    const row = { ...preToRow, stageCorrection: { targetStage: 'primary' as const, disabledReason: 'Уже создана заявка ПСТО.' } }
    render(<PstoWeldLineMoveDialog preview={{ ...correctionPreview, rows: [row], row }}
      initialDecisions={[{ rowId: 7, disposition: 'movePreHeatTreatmentToPrimary' }]}
      pending={false} onClose={vi.fn()} onConfirm={onConfirm} />)
    expect(screen.getByRole('radio', { name: 'Оставить НК до ТО' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить перенос' }))
    expect(onConfirm).toHaveBeenCalledWith([{ rowId: 7, disposition: 'keepPrimary' }])
  })

  it('can switch back to preservation and freezes choices while saving', () => {
    const onConfirm = vi.fn(), onClose = vi.fn()
    const view = render(<PstoWeldLineMoveDialog preview={correctionPreview} pending={false} onClose={onClose} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Весь НК до ТО → основной' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Оставить НК до ТО' }))
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить перенос' }))
    expect(onConfirm).toHaveBeenCalledWith([{ rowId: 7, disposition: 'keepPrimary' }])
    view.rerender(<PstoWeldLineMoveDialog preview={correctionPreview} pending onClose={onClose} onConfirm={onConfirm} />)
    for (const choice of screen.getAllByRole('radio')) expect(choice).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Вернуться к форме' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeDisabled()
  })

  it('leaves Escape to the editor and returning to the form does not submit a selected correction', () => {
    const onConfirm = vi.fn(), onClose = vi.fn()
    render(<PstoWeldLineMoveDialog preview={correctionPreview} pending={false} onClose={onClose} onConfirm={onConfirm} />)
    const transfer = screen.getByRole('radio', { name: 'Весь НК до ТО → основной' })
    fireEvent.click(transfer)
    transfer.focus()
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const outerHandler = vi.fn()
    window.addEventListener('keydown', outerHandler, { once: true })
    fireEvent(transfer, escape)
    expect(outerHandler).toHaveBeenCalledOnce()
    expect(escape.defaultPrevented).toBe(false)
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к форме' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it.each([false, true])('reports the confirmed correction count in the weld editor (chain: %s)', async isChainMove => {
    const second = { ...preToRow, rowId: 8, joint: 'F7R' }
    const preview = { ...correctionPreview, isChainMove, rows: isChainMove ? [preToRow, second] : [preToRow] }
    vi.mocked(getPstoWeldLineMovePreview).mockResolvedValue(preview)
    const { result } = renderHook(useHomeWeldEditorController)
    act(() => result.current.setEditing({ record: { id: 7, ...preview.sourceIdentity } as WeldDraft }))
    act(() => result.current.checkEditedWeldLineMove(preview.targetIdentity))
    await waitFor(() => expect(result.current.pstoLineMovePreSaveDecision?.status).toBe('required'))
    expect(result.current.pstoLineMovePreSaveDecision?.message).toContain('По умолчанию этапы НК сохраняются')
    render(<PstoWeldLineMoveDialog preview={preview} pending={false} onClose={vi.fn()} onConfirm={result.current.confirmPstoLineMove} />)
    fireEvent.click(screen.getAllByRole('radio', { name: 'Весь НК до ТО → основной' })[0]!)
    const confirm = screen.getByRole('button', { name: isChainMove ? 'Подтвердить перенос цепочки' : 'Подтвердить перенос' })
    fireEvent.click(confirm)
    expect(result.current.pstoLineMovePreSaveDecision?.message).toContain(`Стыков: весь НК до ТО → основной — 1; сохранить этапы — ${isChainMove ? 1 : 0}`)
    fireEvent.click(screen.getAllByRole('radio', { name: 'Оставить НК до ТО' })[0]!)
    fireEvent.click(confirm)
    expect(result.current.pstoLineMovePreSaveDecision?.message).toContain('сохранятся на своих этапах')
  })
})
