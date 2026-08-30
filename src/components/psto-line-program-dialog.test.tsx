import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PstoLineProgramDialog } from '@/components/psto-line-program-dialog'
import type { PstoLineAssignmentSummary, PstoLineRemovalPreview } from '@/lib/psto-line-assignment'
import {
  getPstoLineRemovalPreview,
  listPstoLineAssignments,
  savePstoLineAssignment,
} from '@/server/psto-line-assignment'

vi.mock('@/server/psto-line-assignment', () => ({
  getPstoLineRemovalPreview: vi.fn(),
  listPstoLineAssignments: vi.fn(),
  savePstoLineAssignment: vi.fn(),
}))

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
  rowCount: 2,
  assignedCount: 2,
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
      promotablePreMethods: ['ВИК'],
      pendingPreMethods: [],
      primaryMethods: ['ВИК'],
      pstoRequest: 'ПСТО-1',
      pstoResult: '',
      repeatCycleCount: 0,
      preservesPerformedHistory: false,
      hasConflict: true,
      blocksActivation: false,
      activationTransferBlockedMethods: [],
    },
    {
      rowId: 2,
      joint: 'F2',
      spool: 'S1',
      preMethods: ['РК'],
      promotablePreMethods: [],
      pendingPreMethods: ['РК'],
      primaryMethods: [],
      pstoRequest: 'ПСТО-2',
      pstoResult: '',
      repeatCycleCount: 0,
      preservesPerformedHistory: false,
      hasConflict: false,
      blocksActivation: false,
      activationTransferBlockedMethods: [],
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
  rows: [{
    rowId: 11,
    joint: 'F11',
    spool: 'S11',
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
    vi.mocked(listPstoLineAssignments).mockResolvedValue([unassignedLine, assignedLine])
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

  it('shows the full-line impact before assignment', async () => {
    const { onRunProtectedEdit } = renderDialog()
    await screen.findByText('L-100')

    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }))

    expect(screen.getByRole('heading', { name: 'Назначение ПСТО' })).toBeInTheDocument()
    expect(screen.getByText(/4 стыкам линии/)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Назначить ПСТО' })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    await waitFor(() => expect(onRunProtectedEdit).toHaveBeenCalledOnce())
  })

  it('requires an explicit transfer decision for a late PSTO assignment with primary LNK', async () => {
    vi.mocked(getPstoLineRemovalPreview).mockResolvedValue(activationConflictPreview)
    const { onRunProtectedEdit } = renderDialog()
    await screen.findByText('L-100')

    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }))

    expect(await screen.findByText('F11')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Назначить ПСТО' })
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Перенести перечисленные комплекты в «НК до ТО»/ }))
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    await waitFor(() => expect(onRunProtectedEdit).toHaveBeenCalledOnce())
    await waitFor(() => expect(savePstoLineAssignment).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'assign',
        activationDecisions: [{
          rowId: 11,
          disposition: 'movePrimaryToBeforeHeatTreatment',
          methodCodes: ['ВИК', 'РК'],
        }],
      }),
    }))
  })

  it('keeps assignment blocked when the target pre-TO method is already occupied', async () => {
    vi.mocked(getPstoLineRemovalPreview).mockResolvedValue({
      ...activationConflictPreview,
      rows: [{
        ...activationConflictPreview.rows[0]!,
        preMethods: ['ВИК'],
        activationTransferBlockedMethods: ['ВИК'],
      }],
    })
    renderDialog()
    await screen.findByText('L-100')

    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }))

    expect(await screen.findByText(/В «НК до ТО» уже заполнено: ВИК/)).toBeInTheDocument()
    expect(screen.getByText(/Сначала удалите основной результат и заключение/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Перенести перечисленные комплекты/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Назначить ПСТО' })).toBeDisabled()
  })

  it('uses the same guarded transfer when a cancelled PSTO line is reactivated', async () => {
    const cancelledLine: PstoLineAssignmentSummary = {
      ...unassignedLine,
      key: 'line-c',
      line: 'L-300',
      rowCount: 1,
      cancelledCount: 1,
      historyRowCount: 1,
    }
    vi.mocked(listPstoLineAssignments).mockResolvedValue([cancelledLine])
    vi.mocked(getPstoLineRemovalPreview).mockResolvedValue({
      ...activationConflictPreview,
      identity: {
        projectTitle: cancelledLine.projectTitle,
        subtitleCode: cancelledLine.subtitleCode,
        line: cancelledLine.line,
      },
      rowCount: 1,
    })
    renderDialog()
    await screen.findByText('L-300')

    fireEvent.click(screen.getByRole('button', { name: 'Возобновить' }))
    expect(await screen.findByRole('heading', { name: 'Возобновление ПСТО' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Перенести перечисленные комплекты в «НК до ТО»/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Возобновить ПСТО' }))

    await waitFor(() => expect(savePstoLineAssignment).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'reactivate' }),
    }))
  })

  it('requires a choice for every completed pre-TO set during official cancellation', async () => {
    const { onRunProtectedDelete } = renderDialog()
    await screen.findByText('L-200')

    fireEvent.click(screen.getByRole('button', { name: 'Отменить ПСТО' }))

    expect(await screen.findByRole('heading', { name: 'Отмена ПСТО' })).toBeInTheDocument()
    expect(screen.getByText('Дата решения об отмене ПСТО', { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/Без решения:/)).toHaveTextContent('1')
    expect(screen.getByText(/Заявки до ТО без результата будут удалены/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отменить ПСТО на линии' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Оставить основной комплект' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отменить ПСТО на линии' }))

    await waitFor(() => expect(onRunProtectedDelete).toHaveBeenCalledOnce())
  })

  it('explains that cancellation finishes a started physical cycle without opening another repeat', async () => {
    vi.mocked(getPstoLineRemovalPreview).mockResolvedValue({
      ...removalPreview,
      rows: [{
        ...removalPreview.rows[0]!,
        promotablePreMethods: [],
        pendingPreMethods: [],
        preservesPerformedHistory: true,
        hasConflict: false,
      }],
    })
    renderDialog()
    await screen.findByText('L-200')

    fireEvent.click(screen.getByRole('button', { name: 'Отменить ПСТО' }))

    expect(await screen.findByText(/любой результат завершит отмененный цикл/)).toBeInTheDocument()
    expect(screen.getByText(/новый повтор не откроется/)).toBeInTheDocument()
    expect(screen.queryByText(/при необходимости выполнить повторную ПСТО/)).not.toBeInTheDocument()
  })
})
