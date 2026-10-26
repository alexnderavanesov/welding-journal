import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PstoLineProgramDialog } from '@/components/psto-line-program-dialog'
import type { PstoLineAssignmentSummary, PstoLineRemovalPreview } from '@/lib/psto-line-assignment'
import {
  getPstoLineRemovalPreview,
  listPstoLineAssignmentPage,
  savePstoLineAssignment,
} from '@/server/psto-line-assignment'

vi.mock('@/server/psto-line-assignment', () => ({
  getPstoLineRemovalPreview: vi.fn(),
  listPstoLineAssignmentPage: vi.fn(),
  savePstoLineAssignment: vi.fn(),
}))
// The dialog owns server filters; AG's popup geometry is covered in browser tests.
const gridFilter = vi.hoisted(() => ({ change: (_field: string, _value: string) => {} }))
vi.mock('@/components/psto-program-grid', async importOriginal => {
  const original = await importOriginal<typeof import('@/components/psto-program-grid')>()
  return { ...original, PstoProgramGrid: (props: Parameters<typeof original.PstoProgramGrid>[0]) => {
    gridFilter.change = props.onFilterChange
    return <original.PstoProgramGrid {...props} />
  } }
})
vi.mock('@/components/specialist-transfer-confirmation', () => ({ useSpecialistTransferConfirmation: () => ({ ready: true, notice: null, confirmation: undefined }) }))

const unassignedLine: PstoLineAssignmentSummary = {
  key: 'line-a',
  projectTitle: 'Проект А',
  subtitleCode: 'Шифр-1',
  line: 'L-100',
  rowCount: 4,
  assignedCount: 0,
  cancelledCount: 0,
  historyRowCount: 0,
  preControlCount: 0,
  repeatCycleCount: 0,
}

const assignedLine: PstoLineAssignmentSummary = {
  ...unassignedLine,
  key: 'line-b',
  line: 'L-200',
  rowCount: 2,
  assignedCount: 2,
  historyRowCount: 2,
  preControlCount: 2,
}

const removalPreview: PstoLineRemovalPreview = {
  identity: {
    projectTitle: assignedLine.projectTitle,
    subtitleCode: assignedLine.subtitleCode,
    line: assignedLine.line,
  },
  expectedVersions: [
    { id: 1, version: '101' },
    { id: 2, version: '102' },
  ],
  rowCount: 2,
  assignedCount: 2,
  historyRowCount: 2,
  requestOnlyCount: 2,
  completedPstoCount: 0,
  preControlCount: 2,
  completedPreControlCount: 1,
  pendingPreControlCount: 1,
  repeatCycleCount: 0,
  rows: [
    {
      rowId: 1,
      joint: 'F1',
      spool: 'S1',
      preMethods: ['ВИК'],
      completedPreMethods: ['ВИК'],
      pendingPreMethods: [],
      primaryMethods: ['ВИК'],
      pstoRequest: 'ПСТО-1',
      pstoResult: '',
      repeatCycleCount: 0,
      preservesPerformedHistory: false,
    },
    {
      rowId: 2,
      joint: 'F2',
      spool: 'S1',
      preMethods: ['РК'],
      completedPreMethods: [],
      pendingPreMethods: ['РК'],
      primaryMethods: [],
      pstoRequest: 'ПСТО-2',
      pstoResult: '',
      repeatCycleCount: 0,
      preservesPerformedHistory: false,
    },
  ],
}

const cleanAssignmentPreview: PstoLineRemovalPreview = {
  ...removalPreview,
  identity: {
    projectTitle: unassignedLine.projectTitle,
    subtitleCode: unassignedLine.subtitleCode,
    line: unassignedLine.line,
  },
  rowCount: unassignedLine.rowCount,
  assignedCount: 0,
  historyRowCount: 0,
  requestOnlyCount: 0,
  completedPstoCount: 0,
  preControlCount: 0,
  completedPreControlCount: 0,
  pendingPreControlCount: 0,
  repeatCycleCount: 0,
  rows: [],
}

const activationConflictPreview: PstoLineRemovalPreview = {
  ...cleanAssignmentPreview,
  rowCount: 1,
  expectedVersions: [{ id: 11, version: '111' }],
  rows: [{
    rowId: 11,
    joint: 'F11',
    spool: 'S11',
    preMethods: [],
    completedPreMethods: [],
    pendingPreMethods: [],
    primaryMethods: ['ВИК', 'РК'],
    pstoRequest: '',
    pstoResult: '',
    repeatCycleCount: 0,
    preservesPerformedHistory: false,
    stageCorrection: { targetStage: 'beforeHeatTreatment', disabledReason: null },
  }],
}

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onRunProtectedDelete = vi.fn((_label: string, action: () => void | Promise<void>) => action())
  const onRunProtectedEdit = vi.fn((_label: string, action: () => void | Promise<void>) => action())
  render(
    <QueryClientProvider client={queryClient}>
      <PstoLineProgramDialog
        open
        onClose={vi.fn()}
        onRunProtectedEdit={onRunProtectedEdit}
        onRunProtectedDelete={onRunProtectedDelete}
        onSaved={vi.fn()}
      />
    </QueryClientProvider>,
  )
  return { onRunProtectedDelete, onRunProtectedEdit }
}

describe('PstoLineProgramDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(listPstoLineAssignmentPage).mockResolvedValue(linePage([unassignedLine, assignedLine]))
    vi.mocked(getPstoLineRemovalPreview).mockImplementation(async ({ data }) => (
      data.line === unassignedLine.line ? cleanAssignmentPreview : removalPreview
    ))
    vi.mocked(savePstoLineAssignment).mockResolvedValue([])
  })

  it('shows a line-level program and never offers per-joint PSTO assignment', async () => {
    renderDialog()

    expect(await screen.findByText('L-100')).toBeInTheDocument()
    expect(screen.getByText('L-200')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Назначить' })).toBeInTheDocument()
    expect(screen.queryByText(/дубл/i)).not.toBeInTheDocument()
  })

  it('disables stale line actions while a server column filter is pending', async () => {
    renderDialog()
    await screen.findByText('L-100')

    vi.mocked(listPstoLineAssignmentPage).mockImplementationOnce(() => new Promise(() => {}))
    act(() => gridFilter.change('line', 'L-200'))
    await waitFor(() => expect(listPstoLineAssignmentPage).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ filters: { line: expect.stringContaining('L-200') } }),
    })))
    expect(screen.getByRole('button', { name: 'Назначить' })).toBeDisabled()
  })

  it('shows the full-line impact before assignment', async () => {
    const { onRunProtectedEdit } = renderDialog()
    await screen.findByText('L-100')

    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }))

    expect(screen.getByRole('heading', { name: 'Назначение ПСТО' })).toBeInTheDocument()
    expect(screen.getByText('Назначение охватит всю линию. Стыков: 4.')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Назначить ПСТО' })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    await waitFor(() => expect(onRunProtectedEdit).toHaveBeenCalledOnce())
  })

  it('does not reset the requested page while the previous page is a placeholder', async () => {
    let finishPage!: (value: ReturnType<typeof linePage>) => void
    vi.mocked(listPstoLineAssignmentPage)
      .mockResolvedValueOnce({ ...linePage([unassignedLine]), totalCount: 26, pageCount: 2 })
      .mockImplementationOnce(() => new Promise((resolve) => { finishPage = resolve }))
    renderDialog()
    await screen.findByText('L-100')
    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница линий' }))
    await waitFor(() => expect(listPstoLineAssignmentPage).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ page: 2 }),
    })))
    expect(screen.getByRole('button', { name: 'Назначить' })).toBeDisabled()
    await act(async () => finishPage({ ...linePage([assignedLine]), totalCount: 26, pageCount: 2, page: 2 }))
    expect(await screen.findByText('L-200')).toBeInTheDocument()
    expect(screen.getByText('2 из 2')).toBeInTheDocument()
  })

  it.each([false, true])('keeps the main package by default, including when transfer is blocked (%s)', async occupied => {
    vi.mocked(getPstoLineRemovalPreview).mockResolvedValue({
      ...activationConflictPreview,
      rows: [{
        ...activationConflictPreview.rows[0]!, preMethods: occupied ? ['ВИК'] : [],
        stageCorrection: { targetStage: 'beforeHeatTreatment', disabledReason: occupied ? 'НК до ТО уже заполнен.' : null },
      }],
    })
    renderDialog()
      await screen.findByText('L-100')
      fireEvent.click(screen.getByRole('button', { name: 'Назначить' }))
      await screen.findByText(/Проверено стыков:/)
      expect(screen.getByRole('radio', { name: 'Оставить основной НК' })).toBeChecked()
      const transfer = screen.getByRole('radio', { name: 'Весь основной НК → до ТО' })
      if (occupied) {
        expect(transfer).toBeDisabled()
        expect(transfer).toHaveAccessibleDescription('Перенос недоступен: НК до ТО уже заполнен.')
      } else expect(transfer).toBeEnabled()
      const submit = screen.getByRole('button', { name: 'Назначить ПСТО' })
      expect(submit).toBeEnabled()
      fireEvent.click(submit)
      await waitFor(() => expect(savePstoLineAssignment).toHaveBeenCalledOnce())
      expect(vi.mocked(savePstoLineAssignment).mock.calls[0]![0].data).toEqual({
        identity: { projectTitle: unassignedLine.projectTitle, subtitleCode: unassignedLine.subtitleCode, line: unassignedLine.line },
        action: 'assign', expectedVersions: activationConflictPreview.expectedVersions,
        activationDecisions: [{ rowId: 11, disposition: 'keepPrimary' }],
      })
  })

  it('reactivates with the main package kept by default', async () => {
    const cancelledLine = { ...unassignedLine, key: 'line-c', line: 'L-300', rowCount: 1, cancelledCount: 1, historyRowCount: 1 }
    vi.mocked(listPstoLineAssignmentPage).mockResolvedValue(linePage([cancelledLine]))
    vi.mocked(getPstoLineRemovalPreview).mockResolvedValue(activationConflictPreview)
    renderDialog()
    await screen.findByText('L-300')
    fireEvent.click(screen.getByRole('button', { name: 'Возобновить' }))
    await screen.findByText(/Проверено стыков:/)
    expect(screen.getByRole('radio', { name: 'Оставить основной НК' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Возобновить ПСТО' }))
    await waitFor(() => expect(savePstoLineAssignment).toHaveBeenCalledOnce())
    expect(vi.mocked(savePstoLineAssignment).mock.calls[0]![0].data).toMatchObject({ action: 'reactivate' })
    expect(vi.mocked(savePstoLineAssignment).mock.calls[0]![0].data).toHaveProperty('activationDecisions', [{ rowId: 11, disposition: 'keepPrimary' }])
  })

  it.each(['assign', 'reactivate'] as const)('selects whole packages per weld across pages for %s, without extra preview requests', async action => {
    const rows = Array.from({ length: 27 }, (_, index) => ({ ...activationConflictPreview.rows[0]!, rowId: index + 11, joint: `F${index + 11}` }))
    // A row without correction metadata (e.g. already assigned on a partial line) is not offered a choice.
    const preview = { ...activationConflictPreview, rowCount: 28, rows: [...rows, { ...rows[0]!, rowId: 99, joint: 'F99', stageCorrection: undefined }] }
    vi.mocked(getPstoLineRemovalPreview).mockResolvedValue(preview)
    vi.mocked(listPstoLineAssignmentPage).mockResolvedValue(linePage([{
      ...unassignedLine, rowCount: 28, assignedCount: action === 'assign' ? 1 : 0, cancelledCount: action === 'reactivate' ? 28 : 0,
    }]))
    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: action === 'assign' ? 'На всю линию' : 'Возобновить' }))
    const first = within(await screen.findByRole('group', { name: 'Этап НК для стыка F11' }))
    fireEvent.click(first.getByRole('radio', { name: 'Весь основной НК → до ТО' }))
    expect(first.getByRole('radio', { name: 'Весь основной НК → до ТО' })).toBeChecked()
    expect(screen.getAllByRole('group')).toHaveLength(25)
    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница стыков' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Этап НК для стыка F37' })).getByRole('radio', { name: 'Весь основной НК → до ТО' }))
    expect(screen.queryByText('F99')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Перенести в НК до ТО: 2 · сохранить этапы: 26')
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущая страница стыков' }))
    expect(screen.getAllByRole('radio', { name: 'Весь основной НК → до ТО' })[0]).toBeChecked()
    expect(getPstoLineRemovalPreview).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: action === 'assign' ? 'Назначить ПСТО' : 'Возобновить ПСТО' }))
    await waitFor(() => expect(savePstoLineAssignment).toHaveBeenCalledOnce())
    expect(vi.mocked(savePstoLineAssignment).mock.calls[0]![0].data).toMatchObject({
      action,
      activationDecisions: rows.map(row => ({ rowId: row.rowId, disposition: [11, 37].includes(row.rowId) ? 'movePrimaryToPreHeatTreatment' : 'keepPrimary' })),
    })
  })

  it('cancels a draft and restores default preservation when reopened', async () => {
    vi.mocked(getPstoLineRemovalPreview).mockResolvedValue(activationConflictPreview)
    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Назначить' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Весь основной НК → до ТО' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(savePstoLineAssignment).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Назначить' }))
    expect(await screen.findByRole('radio', { name: 'Оставить основной НК' })).toBeChecked()
  })

  it('does not consume Escape or submit a selected correction; the outer dialog still owns Escape', async () => {
    vi.mocked(getPstoLineRemovalPreview).mockResolvedValue(activationConflictPreview)
    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Назначить' }))
    const transfer = await screen.findByRole('radio', { name: 'Весь основной НК → до ТО' })
    fireEvent.click(transfer)
    transfer.focus()
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const outerHandler = vi.fn()
    window.addEventListener('keydown', outerHandler, { once: true })
    fireEvent(transfer, escape)
    expect(outerHandler).toHaveBeenCalledOnce()
    expect(escape.defaultPrevented).toBe(false)
    expect(savePstoLineAssignment).not.toHaveBeenCalled()
  })

  it('offers no correction for rows without metadata or with the other target stage', async () => {
    vi.mocked(getPstoLineRemovalPreview).mockResolvedValue({
      ...activationConflictPreview,
      rows: [{ ...activationConflictPreview.rows[0]!, stageCorrection: undefined }, {
        ...activationConflictPreview.rows[0]!, rowId: 12, stageCorrection: { targetStage: 'primary', disabledReason: null },
      }],
    })
    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Назначить' }))
    await screen.findByText(/Проверено стыков:/)
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Назначить ПСТО' }))
    await waitFor(() => expect(savePstoLineAssignment).toHaveBeenCalledOnce())
    expect(vi.mocked(savePstoLineAssignment).mock.calls[0]![0].data).not.toHaveProperty('activationDecisions')
  })

  it('blocks stale removal when history appeared and offers explicit official cancellation without deleting documents', async () => {
    vi.mocked(listPstoLineAssignmentPage).mockResolvedValue(linePage([{
      ...assignedLine, historyRowCount: 0, preControlCount: 0,
    }]))
    const { onRunProtectedDelete } = renderDialog()
    await screen.findByText('L-200')
    fireEvent.click(screen.getByRole('button', { name: 'Снять назначение' }))

    expect(await screen.findByText(/История линии изменилась/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Снять назначение' })).toBeDisabled()
    expect(screen.queryByText(/будут удалены|Перенести завершенный|Всем: перенести/)).not.toBeInTheDocument()
    expect(onRunProtectedDelete).not.toHaveBeenCalled()
    expect(savePstoLineAssignment).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Перейти к отмене ПСТО' }))
    expect(await screen.findByRole('heading', { name: 'Отмена ПСТО' })).toBeInTheDocument()
    expect(screen.getByText(/Отмена не удаляет историю/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отменить ПСТО на линии' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(savePstoLineAssignment).not.toHaveBeenCalled()
    expect(getPstoLineRemovalPreview).toHaveBeenCalledTimes(1)
  })

  it('offers deletion without cancellation when another operator removed all history', async () => {
    vi.mocked(getPstoLineRemovalPreview).mockResolvedValue({
      ...cleanAssignmentPreview, identity: removalPreview.identity,
      assignedCount: 2, rowCount: 2,
      rows: activationConflictPreview.rows,
    })
    renderDialog()
    await screen.findByText('L-200')
    fireEvent.click(screen.getByRole('button', { name: 'Отменить ПСТО' }))
    expect(await screen.findByText(/История линии изменилась/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отменить ПСТО на линии' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Перейти к снятию назначения' }))
    expect(await screen.findByRole('heading', { name: 'Снятие назначения ПСТО' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Снять назначение' })).toBeEnabled()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Снять назначение' }))
    await waitFor(() => expect(savePstoLineAssignment).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'remove' }),
    }))
    expect(getPstoLineRemovalPreview).toHaveBeenCalledTimes(1)
    expect(vi.mocked(savePstoLineAssignment).mock.calls[0]![0].data).not.toHaveProperty('activationDecisions')
  })

  it('preserves stages by default during cancellation while offering explicit whole-package correction', async () => {
    vi.mocked(getPstoLineRemovalPreview).mockResolvedValue({
      ...removalPreview, rows: [{ ...activationConflictPreview.rows[0]!, stageCorrection: { targetStage: 'primary', disabledReason: null } }],
    })
    const { onRunProtectedDelete } = renderDialog()
    await screen.findByText('L-200')

    fireEvent.click(screen.getByRole('button', { name: 'Отменить ПСТО' }))

    expect(await screen.findByRole('heading', { name: 'Отмена ПСТО' })).toBeInTheDocument()
    expect(screen.getByText('Дата решения об отмене ПСТО', { exact: false })).toBeInTheDocument()
    expect(screen.queryByText(/Без решения:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/будут удалены/)).not.toBeInTheDocument()
    expect(screen.getByText(/Отмена не удаляет историю/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Оставить НК до ТО' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Отменить ПСТО на линии' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Отменить ПСТО на линии' }))

    await waitFor(() => expect(onRunProtectedDelete).toHaveBeenCalledOnce())
    expect(vi.mocked(savePstoLineAssignment).mock.calls[0]![0].data.activationDecisions).toEqual([{ rowId: 11, disposition: 'keepPrimary' }])
  })

  it('explains that cancellation finishes a started physical cycle without opening another repeat', async () => {
    vi.mocked(getPstoLineRemovalPreview).mockResolvedValue({
      ...removalPreview,
      rows: [{
        ...removalPreview.rows[0]!,
        completedPreMethods: [],
        pendingPreMethods: [],
        preservesPerformedHistory: true,
      }],
    })
    renderDialog()
    await screen.findByText('L-200')

    fireEvent.click(screen.getByRole('button', { name: 'Отменить ПСТО' }))

    expect(await screen.findByText(/внесите фактическую ТВМТ/)).toBeInTheDocument()
    expect(screen.getByText(/новый повтор не откроется/)).toBeInTheDocument()
    expect(screen.queryByText(/при необходимости выполнить повторную ПСТО/)).not.toBeInTheDocument()
  })
})

function linePage(rows: PstoLineAssignmentSummary[]) {
  return {
    rows,
    totalCount: rows.length,
    page: 1,
    pageSize: 25,
    pageCount: 1,
    counts: {
      all: rows.length,
      assigned: rows.filter((row) => row.assignedCount === row.rowCount).length,
      cancelled: rows.filter((row) => row.cancelledCount === row.rowCount).length,
      unassigned: rows.filter((row) => row.assignedCount === 0 && row.cancelledCount === 0).length,
      partial: rows.filter((row) => (
        row.assignedCount !== row.rowCount &&
        row.cancelledCount !== row.rowCount &&
        (row.assignedCount > 0 || row.cancelledCount > 0)
      )).length,
    },
  }
}
