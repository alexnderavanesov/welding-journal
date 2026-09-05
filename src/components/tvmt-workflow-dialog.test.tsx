import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TvmtWorkflowDialog } from '@/components/tvmt-workflow-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'
import { SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY } from '@/lib/system-document-sequence-storage'

function makeRow(overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 1,
    projectTitle: 'Проект А',
    subtitleCode: 'Шифр-1',
    line: 'Линия-1',
    joint: 'F1',
    pstoRequired: 'да',
    pstoRequest: 'ПСТО-27.08.26-001',
    pstoRequestDate: '2026-08-27',
    pstoDate: '2026-08-28',
    pstoResult: 'проведено',
    ...overrides,
  } as WeldRow
}

function renderDialog(
  mode: 'request' | 'result',
  rowOrRows: WeldRow | WeldRow[],
  initialSelectedIds?: ReadonlySet<number>,
  onOpenResultManager = vi.fn(),
  onRunRootCauseAction: React.ComponentProps<typeof TvmtWorkflowDialog>['onRunRootCauseAction'] = vi.fn(),
) {
  let currentRows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
  let currentSelectedIds = initialSelectedIds ?? new Set(currentRows.map((row) => row.id))
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY, {
    tvmtRequest: 10,
    tvmtConclusion: 20,
  })
  const renderTree = () => (
    <QueryClientProvider client={queryClient}>
      <TvmtWorkflowDialog
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
    rerenderWithRows: (rows: WeldRow[]) => {
      currentRows = rows
      view.rerender(renderTree())
    },
  }
}

describe('TvmtWorkflowDialog', () => {
  it('preselects a joint for a TVMT request only after completed PSTO', () => {
    renderDialog('request', makeRow())

    expect(screen.getByRole('heading', { name: 'Заявка ТВМТ' })).toBeInTheDocument()
    expect(screen.queryByText('Циклы')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeChecked()
    expect(screen.getByText('ожидает заявку ТВМТ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать заявку' })).toBeEnabled()
  })

  it('offers both exact date corrections and keeps the current TVMT draft in place', () => {
    const onRunRootCauseAction = vi.fn()
    renderDialog('request', makeRow(), undefined, vi.fn(), onRunRootCauseAction)
    const dateInput = screen.getByLabelText('Дата заявки')

    fireEvent.change(dateInput, { target: { value: '2026-08-27' } })

    fireEvent.click(screen.getByRole('button', { name: 'Исправить дату заявки ТВМТ' }))
    expect(dateInput).toHaveFocus()
    expect(onRunRootCauseAction).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Исправить дату ПСТО' }))
    expect(onRunRootCauseAction).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({
        kind: 'psto-cycle',
        rowId: 1,
        sequence: 1,
        stage: 'pstoResult',
        documentDate: '2026-08-28',
      }),
    }))
  })

  it('restores the selected TVMT row when report data loads after the dialog opens', async () => {
    const view = renderDialog('request', [], new Set([1]))

    expect(screen.getByText('Найдено: 0 · Доступно: 0')).toBeInTheDocument()
    view.rerenderWithRows([makeRow()])

    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeChecked())
    expect(screen.getByRole('button', { name: 'Создать заявку' })).toBeEnabled()
  })

  it('restores the exact TVMT request for a result when report data loads after the dialog opens', async () => {
    const waitingResult = makeRow({
      tvmtRequest: 'Заявка-ТВМТ-001',
      tvmtRequestDate: '2026-08-29',
      tvmtResult: 'ожидает НК',
    })
    const view = renderDialog('result', [], new Set([waitingResult.id]))

    expect(screen.getByRole('combobox', { name: 'Заявка ТВМТ' })).toHaveValue('')
    view.rerenderWithRows([waitingResult])

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Заявка ТВМТ' })).toHaveValue(
      'Заявка-ТВМТ-001 · 29.08.2026',
    ))
    expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Сохранить результат' })).toBeDisabled()
  })

  it('opens result entry for the exact TVMT request and keeps the row result explicit', () => {
    renderDialog('result', makeRow({
      tvmtRequest: 'Заявка-ТВМТ-001',
      tvmtRequestDate: '2026-08-28',
      tvmtResult: 'ожидает НК',
    }))

    expect(screen.getByRole('heading', { name: 'Внесение результатов ТВМТ' })).toBeInTheDocument()
    const goodResult = screen.getByRole('button', { name: 'годен' })
    const failedResult = screen.getByRole('button', { name: 'не годен' })
    expect(goodResult).toHaveAttribute('aria-pressed', 'false')
    expect(failedResult).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Сохранить результат' })).toBeDisabled()

    fireEvent.click(failedResult)

    expect(failedResult).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Сохранить результат' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Все результаты' })).toBeEnabled()
  })

  it('does not allow a TVMT request before PSTO is completed', () => {
    renderDialog('request', makeRow({ pstoResult: 'ожидает ПСТО', pstoDate: null }))

    expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Создать заявку' })).toBeDisabled()
  })

  it('shows the missing pre-TO step when PSTO cannot start yet', () => {
    renderDialog('request', makeRow({
      hasVik: 'да',
      pstoRequest: null,
      pstoRequestDate: null,
      pstoResult: null,
      pstoDate: null,
      preHeatTreatmentControls: [],
    }))

    expect(screen.getByText('ожидает заявку НК до ТО: ВИК')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeDisabled()
  })

  it('uses the current repeat PSTO cycle without exposing duplicate controls as a stage', () => {
    renderDialog('request', makeRow({
      tvmtResult: 'не годен',
      tvmtConclusionDate: '2026-08-29',
      pstoRepeatCycles: [{
        id: 7,
        weldJointId: 1,
        sequence: 2,
        pstoRequest: 'Повторная ПСТО-2',
        pstoRequestDate: '2026-08-30',
        pstoDate: '2026-08-31',
        pstoResult: 'проведено',
      }],
      duplicateControls: [{
        id: 8,
        weldJointId: 1,
        method: 'РК',
        result: 'ремонт',
        controlDate: '2026-08-30',
        conclusion: 'Дубль',
        conclusionDate: '2026-08-30',
      }],
    }))

    const cycleBadge = screen.getByText('Цикл 2')
    expect(cycleBadge).toBeInTheDocument()
    expect(cycleBadge.parentElement).toHaveClass('grid-cols-[52px_78px_minmax(0,1fr)]')
    expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeChecked()
    expect(screen.queryByText(/дубл/i)).not.toBeInTheDocument()
  })

  it('keeps TVMT positions from different PSTO cycles in one request document', () => {
    renderDialog('request', [
      makeRow(),
      makeRow({
        id: 2,
        joint: 'F2',
        tvmtResult: 'не годен',
        tvmtConclusionDate: '2026-08-29',
        pstoRepeatCycles: [{
          id: 7,
          weldJointId: 2,
          sequence: 2,
          pstoRequest: 'Повторная ПСТО-2',
          pstoRequestDate: '2026-08-30',
          pstoDate: '2026-08-31',
          pstoResult: 'проведено',
        }],
      }),
    ])

    expect(screen.getAllByRole('checkbox', { name: /Выбрать стык/ })).toHaveLength(2)
    expect(screen.getByRole('tab', { name: /Заявки и имена1/ })).toBeInTheDocument()
  })

  it('bulk-selects only TVMT rows from the current search result', async () => {
    renderDialog('request', [
      makeRow({ id: 1, line: 'AUDIT-LINE-10', joint: 'F1' }),
      makeRow({ id: 2, line: 'OTHER-LINE', joint: 'F2' }),
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
