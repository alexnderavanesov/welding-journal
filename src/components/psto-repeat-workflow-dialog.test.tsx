import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PstoRepeatWorkflowDialog } from '@/components/psto-repeat-workflow-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'
import { SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY } from '@/lib/system-document-sequence-storage'

function makeFailedTvmtRow(overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 1,
    projectTitle: 'Проект А',
    subtitleCode: 'Шифр-1',
    line: 'Линия-1',
    joint: 'F1',
    pstoRequired: 'да',
    pstoRequest: 'ПСТО-1',
    pstoRequestDate: '2026-08-20',
    pstoDate: '2026-08-21',
    pstoResult: 'проведено',
    tvmtRequest: 'ТВМТ-1',
    tvmtRequestDate: '2026-08-21',
    tvmtResult: 'не годен',
    tvmtConclusionDate: '2026-08-22',
    tvmtConclusion: 'ЗТВМТ-1',
    ...overrides,
  } as WeldRow
}

function renderDialog(
  mode: 'request' | 'result',
  rowOrRows: WeldRow | WeldRow[],
  initialSelectedIds?: ReadonlySet<number>,
  onOpenResultManager = vi.fn(),
  onRunRootCauseAction: React.ComponentProps<typeof PstoRepeatWorkflowDialog>['onRunRootCauseAction'] = vi.fn(),
) {
  let currentRows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
  let currentSelectedIds = initialSelectedIds ?? new Set(currentRows.map((row) => row.id))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY, {
    pstoRequest: 5,
    pstoConclusion: 7,
  })
  const renderTree = () => (
    <QueryClientProvider client={queryClient}>
      <PstoRepeatWorkflowDialog
        mode={mode}
        rows={currentRows}
        initialSelectedIds={currentSelectedIds}
        onClose={vi.fn()}
        onRunProtectedEdit={(_label, action) => action()}
        onSaved={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onOpenResultManager={onOpenResultManager}
        onRunRootCauseAction={onRunRootCauseAction}
      />
    </QueryClientProvider>
  )
  const view = render(renderTree())
  return {
    ...view,
    rerenderWithInitialSelectedIds: (selectedIds: ReadonlySet<number>) => {
      currentSelectedIds = selectedIds
      view.rerender(renderTree())
    },
    rerenderWithRows: (rows: WeldRow[]) => {
      currentRows = rows
      view.rerender(renderTree())
    },
  }
}

describe('PstoRepeatWorkflowDialog', () => {
  it('offers the next cycle only after failed TVMT', () => {
    renderDialog('request', makeFailedTvmtRow())

    expect(screen.getByRole('heading', { name: 'Заявка ПСТО' })).toBeInTheDocument()
    const cycleBadge = screen.getByText('Цикл 2')
    expect(cycleBadge).toBeInTheDocument()
    expect(cycleBadge.parentElement).toHaveClass('grid-cols-[78px_minmax(0,1fr)]')
    expect(screen.queryByText('Циклы')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Создать заявку' })).toBeEnabled()
  })

  it('focuses the repeat draft date and routes the previous-cycle alternative precisely', () => {
    const onRunRootCauseAction = vi.fn()
    renderDialog('request', makeFailedTvmtRow(), undefined, vi.fn(), onRunRootCauseAction)
    const dateInput = screen.getByLabelText('Дата заявки')

    fireEvent.change(dateInput, { target: { value: '2026-08-21' } })

    fireEvent.click(screen.getByRole('button', { name: 'Исправить дату заявки ПСТО цикла №2' }))
    expect(dateInput).toHaveFocus()
    expect(onRunRootCauseAction).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Исправить дату заключения ТВМТ' }))
    expect(onRunRootCauseAction).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({
        kind: 'psto-cycle',
        rowId: 1,
        sequence: 1,
        stage: 'tvmtResult',
        documentDate: '2026-08-22',
      }),
    }))
  })

  it('opens result entry for the current repeat request', () => {
    renderDialog('result', makeFailedTvmtRow({
      pstoRepeatCycles: [{
        id: 9,
        weldJointId: 1,
        sequence: 2,
        pstoRequest: 'Повторная ПСТО-2',
        pstoRequestDate: '2026-08-23',
      }],
    }))

    expect(screen.getByRole('heading', { name: 'Внесение результатов ПСТО' })).toBeInTheDocument()
    expect(screen.getByText('Повторная ПСТО-2')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Все результаты' })).toBeEnabled()
  })

  it('selects the exact row request when the table selection arrives after the dialog opens', async () => {
    const makeWaitingResultRow = (id: number, joint: string, requestName: string) => makeFailedTvmtRow({
      id,
      joint,
      pstoRequest: requestName,
      pstoRequestDate: '2026-08-23',
      pstoDate: null,
      pstoResult: 'ожидает',
      tvmtRequest: null,
      tvmtRequestDate: null,
      tvmtResult: null,
      tvmtConclusionDate: null,
      tvmtConclusion: null,
    })
    const rows = [
      makeWaitingResultRow(1, 'F1', 'Заявка ПСТО-A'),
      makeWaitingResultRow(2, 'F2', 'Заявка ПСТО-B'),
    ]
    const view = renderDialog('result', rows, new Set())

    expect(screen.getByRole('combobox', { name: 'Заявка ПСТО' })).toHaveValue('')
    view.rerenderWithInitialSelectedIds(new Set([2]))

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Заявка ПСТО' })).toHaveValue(
      'Заявка ПСТО-B · 23.08.2026',
    ))
    expect(screen.getByRole('checkbox', { name: /F2/ })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /F1/ })).not.toBeInTheDocument()
  })

  it('restores the selected PSTO row when report data loads after the dialog opens', async () => {
    const view = renderDialog('request', [], new Set([1]))

    expect(screen.getByText('Найдено: 0 · Доступно: 0')).toBeInTheDocument()
    view.rerenderWithRows([makeFailedTvmtRow()])

    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeChecked())
    expect(screen.getByRole('button', { name: 'Создать заявку' })).toBeEnabled()
  })

  it('restores the exact PSTO request for a result when report data loads after the dialog opens', async () => {
    const waitingResult = makeFailedTvmtRow({
      pstoRequest: 'Заявка ПСТО-A',
      pstoRequestDate: '2026-08-23',
      pstoDate: null,
      pstoResult: 'ожидает ПСТО',
      tvmtRequest: null,
      tvmtRequestDate: null,
      tvmtResult: null,
      tvmtConclusionDate: null,
      tvmtConclusion: null,
    })
    const view = renderDialog('result', [], new Set([waitingResult.id]))

    expect(screen.getByRole('combobox', { name: 'Заявка ПСТО' })).toHaveValue('')
    view.rerenderWithRows([waitingResult])

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Заявка ПСТО' })).toHaveValue(
      'Заявка ПСТО-A · 23.08.2026',
    ))
    expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Сохранить результат' })).toBeEnabled()
  })

  it('does not treat duplicates as a reason for a repeat PSTO cycle', () => {
    renderDialog('request', makeFailedTvmtRow({
      tvmtResult: 'годен',
      duplicateControls: [{
        id: 2,
        weldJointId: 1,
        method: 'РК',
        result: 'ремонт',
        controlDate: '2026-08-22',
        conclusion: 'Дубль',
        conclusionDate: '2026-08-22',
      }],
    }))

    expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeDisabled()
    expect(screen.queryByText(/дубл/i)).not.toBeInTheDocument()
  })

  it('shows the actual prerequisite instead of a failed TVMT badge for unavailable rows', () => {
    renderDialog('request', makeFailedTvmtRow({
      pstoRequest: null,
      pstoRequestDate: null,
      pstoDate: null,
      pstoResult: null,
      tvmtRequest: null,
      tvmtRequestDate: null,
      tvmtResult: null,
      tvmtConclusionDate: null,
      tvmtConclusion: null,
      hasVik: 'да',
    }))

    expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeDisabled()
    expect(screen.getByText('Недоступно: Сначала создайте заявки НК до ТО: ВИК.')).toBeInTheDocument()
    expect(screen.queryByText(/ТВМТ не годен/)).not.toBeInTheDocument()
    expect(screen.queryByText('Цикл 2')).not.toBeInTheDocument()
  })

  it('keeps primary and repeat-cycle positions in one PSTO request document', () => {
    renderDialog('request', [
      makeFailedTvmtRow(),
      makeFailedTvmtRow({
        id: 2,
        joint: 'F2',
        pstoRequest: null,
        pstoRequestDate: null,
        pstoDate: null,
        pstoResult: null,
        tvmtRequest: null,
        tvmtRequestDate: null,
        tvmtResult: null,
        tvmtConclusionDate: null,
        tvmtConclusion: null,
      }),
    ])

    expect(screen.getAllByRole('checkbox', { name: /Выбрать стык/ })).toHaveLength(2)
    expect(screen.getByRole('tab', { name: /Заявки и имена1/ })).toBeInTheDocument()
    expect(screen.queryByText('Циклы')).not.toBeInTheDocument()
  })

  it('bulk-selects only PSTO rows from the current search result', async () => {
    renderDialog('request', [
      makeFailedTvmtRow({ id: 1, line: 'AUDIT-LINE-10', joint: 'F1' }),
      makeFailedTvmtRow({ id: 2, line: 'OTHER-LINE', joint: 'F2' }),
    ], new Set())

    fireEvent.change(screen.getByPlaceholderText('Проект, шифр, линия, спул или стык'), {
      target: { value: 'AUDIT-LINE-10' },
    })
    await waitFor(() => expect(screen.getByText('Найдено: 1 · Доступно: 1')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать доступные' }))

    expect(screen.getByRole('button', { name: 'Выбрано: 1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Очистить' }))
    expect(screen.getByRole('checkbox', { name: /F2/ })).not.toBeChecked()
  })
})
