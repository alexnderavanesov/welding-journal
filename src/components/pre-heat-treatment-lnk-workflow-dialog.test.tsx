import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PreHeatTreatmentLnkWorkflowDialog } from '@/components/pre-heat-treatment-lnk-workflow-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { PreHeatTreatmentLnkMethodCode } from '@/lib/lnk-control-stage'
import { SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY } from '@/lib/system-document-sequence-storage'

import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
vi.mock('@/server/document-grouping-preferences', () => ({ getDocumentGroupingDefaults: vi.fn(async () => REQUEST_CONCLUSION_DEFAULT_SETTINGS) }))
vi.mock('@/server/system-document-sequences', () => ({ getSystemDocumentSequences: vi.fn(async () => ({ lnkRequest: 10, lnkConclusionVik: 20, lnkConclusionRk: 30, 'lnkRequest:beforeHeatTreatment': 110, 'lnkConclusionVik:beforeHeatTreatment': 120, 'lnkConclusionRk:beforeHeatTreatment': 130 })) }))

function makeRow(overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 1,
    projectTitle: 'Проект А',
    subtitleCode: 'Шифр-1',
    line: 'Линия-1',
    joint: 'F1',
    weldDate: '2026-08-01',
    pstoRequired: 'да',
    pstoDate: null,
    hasVik: 'да',
    hasRk: 'да',
    hasUzk: '',
    hasPvk: '',
    ...overrides,
  } as WeldRow
}

async function renderDialogRows(
  mode: 'request' | 'result',
  initialRows: WeldRow[],
  initialSelectedIds = new Set(initialRows.map((row) => row.id)),
  initialMethodCode?: PreHeatTreatmentLnkMethodCode,
  options: {
    initialRequestSubmitMode?: 'create' | 'extend'
    onStageChange?: (
      stage: 'primary' | 'beforeHeatTreatment',
      selectedRowIds: number[],
      submitMode: 'create' | 'extend',
    ) => void
    onRunRootCauseAction?: React.ComponentProps<typeof PreHeatTreatmentLnkWorkflowDialog>['onRunRootCauseAction']
  } = {},
) {
  let rows = initialRows
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY, {
    lnkRequest: 10,
    lnkConclusionVik: 20,
    lnkConclusionRk: 30,
    'lnkRequest:beforeHeatTreatment': 110,
    'lnkConclusionVik:beforeHeatTreatment': 120,
    'lnkConclusionRk:beforeHeatTreatment': 130,
  })
  const renderTree = () => (
    <QueryClientProvider client={queryClient}>
      <PreHeatTreatmentLnkWorkflowDialog
        mode={mode}
        rows={rows}
        initialSelectedIds={initialSelectedIds}
        initialMethodCode={initialMethodCode}
        initialRequestSubmitMode={options.initialRequestSubmitMode}
        onClose={vi.fn()}
        onRunProtectedEdit={(_label, action) => action()}
        onSaved={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onStageChange={options.onStageChange}
        onRunRootCauseAction={options.onRunRootCauseAction}
      />
    </QueryClientProvider>
  )
  let view!: ReturnType<typeof render>
  await act(async () => { view = render(renderTree()) })
  return {
    ...view,
    rerenderWithRows: (nextRows: WeldRow[]) => {
      rows = nextRows
      view.rerender(renderTree())
    },
  }
}

async function renderDialog(mode: 'request' | 'result', row: WeldRow) {
  await renderDialogRows(mode, [row])
}

describe('PreHeatTreatmentLnkWorkflowDialog', async () => {
  it('starts with a system name using the pre-TO formula and its own next number', async () => {
    await renderDialog('request', makeRow())
    fireEvent.click(screen.getByRole('tab', { name: /Заявки и имена/ }))
    expect(within(screen.getByRole('group', { name: 'Наименование заявки' })).getByRole('button', { name: 'Системное' })).toHaveAttribute('aria-pressed', 'true')
    const names = screen.getAllByRole('textbox').filter(input => (input as HTMLInputElement).value.includes('ДО-ТО'))
    expect(names.length).toBeGreaterThan(0)
    expect((names[0] as HTMLInputElement).value).toMatch(/ДО-ТО-.*-110$/)
  })
  it('applies the same selected-row matrix before heat treatment with hover and focus reasons', async () => {
    const request = { requestName: 'РК-до-ТО', requestDate: '2026-08-20', result: 'ожидает НК' }
    await renderDialogRows('result', [
      makeRow({ id: 1, joint: 'F1', d1: 57, preHeatTreatmentControls: [
        { id: 11, weldJointId: 1, method: 'ВИК', result: 'годен' },
        { id: 1, weldJointId: 1, method: 'РК', ...request },
      ] }),
      makeRow({ id: 2, joint: 'F2R2', d1: 89, preHeatTreatmentControls: [
        { id: 12, weldJointId: 2, method: 'ВИК', result: 'годен' },
        { id: 2, weldJointId: 2, method: 'РК', ...request },
      ] }),
    ], new Set([1, 2]), 'РК')
    const picker = within(screen.getByRole('group', { name: 'Результат для всех выбранных' }))
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /Выбрать стык/ })[0]).toBeChecked())
    expect(picker.getByRole('button', { name: 'ремонт' })).toBeDisabled()
    fireEvent.focus(picker.getByRole('group', { name: 'ремонт' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('меньше 89 мм')
    expect(screen.getByRole('tooltip')).toHaveTextContent('два ремонта')
    expect(picker.getByRole('button', { name: 'вырез' })).toBeEnabled()
    for (const button of screen.getAllByRole('button', { name: 'годен' })) {
      expect(button).toHaveAttribute('aria-pressed', 'false')
    }
    fireEvent.blur(picker.getByRole('group', { name: 'ремонт' }))
    fireEvent.mouseEnter(screen.getAllByRole('group', { name: 'ремонт' })[1]!)
    expect(screen.getByRole('tooltip')).toHaveTextContent('меньше 89 мм')
  })
  it('preselects only assigned request methods and keeps duplicate controls outside the workflow', async () => {
    await renderDialog('request', makeRow({
      duplicateControls: [{
        id: 8,
        weldJointId: 1,
        method: 'РК',
        result: 'ремонт',
        controlDate: '2026-08-20',
        conclusion: 'Дубль-1',
        conclusionDate: '2026-08-20',
      }],
    }))

    expect(screen.getByRole('dialog')).toHaveClass('max-w-[1480px]', 'h-[calc(100dvh-1rem)]')
    expect(screen.getByRole('heading', { name: 'Заявка ЛНК до ТО' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Все заявки' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ВИК' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'РК' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'УЗК' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Создать заявку до ТО' })).toBeEnabled()
    expect(screen.queryByText(/Дубль-1/)).not.toBeInTheDocument()
  })

  it('restores the exact pre-TO method and row when report data loads after the dialog opens', async () => {
    const view = await renderDialogRows('request', [], new Set([1]), 'РК')

    expect(screen.getByText('Найдено: 0 · Доступно: 0')).toBeInTheDocument()
    view.rerenderWithRows([makeRow()])

    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeChecked())
    expect(screen.getByRole('button', { name: 'ВИК' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'РК' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Создать заявку до ТО' })).toBeEnabled()
  })

  it('opens the requested VIK position for a result without offering a shared pre/post stage switch', async () => {
    await renderDialog('result', makeRow({
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка-ВИК-до-ТО-001',
        requestDate: '2026-08-20',
        result: 'ожидает НК',
      }],
    }))

    expect(screen.getByRole('heading', { name: 'Внесение результатов ЛНК до ТО' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Все результаты' })).toBeInTheDocument()
    expect(screen.getByText('Результат для всех выбранных')).toBeInTheDocument()
    expect(screen.getByText('Заявка ЛНК до ТО')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Метод контроля' })).toHaveValue('ВИК')
    expect(await screen.findByRole('checkbox', { name: /Выбрать стык/ })).toBeChecked()
    expect(screen.queryByRole('combobox', { name: /этап/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить результат до ТО' })).toBeDisabled()
  })

  it('chooses a pending method from the selected joint instead of another request in the report', async () => {
    const selectedRow = makeRow({
      id: 904,
      joint: 'F904',
      preHeatTreatmentControls: [
        {
          id: 1,
          weldJointId: 904,
          method: 'ВИК',
          requestName: 'Заявка-F904',
          requestDate: '2026-08-20',
          result: 'годен',
          conclusionDate: '2026-08-21',
          conclusionName: 'ВИК-F904',
        },
        {
          id: 2,
          weldJointId: 904,
          method: 'РК',
          requestName: 'Заявка-F904',
          requestDate: '2026-08-20',
          result: 'ожидает НК',
        },
      ],
    })
    const otherRow = makeRow({
      id: 13,
      joint: 'S13',
      preHeatTreatmentControls: [{
        id: 3,
        weldJointId: 13,
        method: 'ВИК',
        requestName: 'Чужая заявка',
        requestDate: '2026-08-20',
        result: 'ожидает НК',
      }],
    })

    await renderDialogRows('result', [otherRow, selectedRow], new Set([selectedRow.id]))

    expect(screen.getByRole('combobox', { name: 'Метод контроля' })).toHaveValue('РК')
    expect(await screen.findByRole('checkbox', { name: /F904/ })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /S13/ })).not.toBeInTheDocument()
  })

  it('does not allow a pre-heat-treatment request on a line without PSTO', async () => {
    await renderDialog('request', makeRow({ pstoRequired: '', pstoDate: null }))

    expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Создать заявку до ТО' })).toBeDisabled()
  })

  it('keeps the draft local and routes the alternative exact correction for a pre-TO conflict', async () => {
    const onRunRootCauseAction = vi.fn()
    await renderDialogRows('request', [makeRow({ pstoDate: '2026-09-10' })], new Set([1]), 'ВИК', { onRunRootCauseAction })
    const dateInput = screen.getByLabelText('Дата заявки')

    fireEvent.change(dateInput, { target: { value: '2026-09-11' } })

    const localAction = screen.getByRole('button', { name: 'Исправить дату заявки ВИК до ТО' })
    const externalAction = screen.getByRole('button', { name: 'Исправить дату ПСТО' })
    expect(screen.getByRole('checkbox', { name: /Выбрать стык/ })).toBeChecked()
    fireEvent.click(localAction)
    expect(dateInput).toHaveFocus()
    expect(onRunRootCauseAction).not.toHaveBeenCalled()

    fireEvent.click(externalAction)
    expect(onRunRootCauseAction).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({
        kind: 'psto-cycle',
        rowId: 1,
        sequence: 1,
        stage: 'pstoResult',
        documentDate: '2026-09-10',
      }),
    }))
  })

  it('labels the footer as adding positions when an existing request is selected', async () => {
    await renderDialog('request', makeRow({
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка-ВИК-до-ТО-001',
        requestDate: '2026-08-20',
        result: 'ожидает НК',
      }],
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Добавить в существующую' }))

    expect(screen.getByRole('button', { name: 'Добавить в заявку до ТО' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Создать заявку до ТО' })).not.toBeInTheDocument()
  })

  it('keeps the stage switch available while adding positions to an existing pre-TO request', async () => {
    const onStageChange = vi.fn()
    const row = makeRow()
    await renderDialogRows('request', [row], new Set([row.id]), undefined, {
      initialRequestSubmitMode: 'extend',
      onStageChange,
    })

    expect(screen.getByRole('button', { name: 'Добавить в существующую' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Основной' }))
    expect(onStageChange).toHaveBeenCalledWith('primary', [row.id], 'extend')
  })

  it('bulk-selects only available rows from the current search result', async () => {
    await renderDialogRows('request', [
      makeRow({ id: 1, line: 'AUDIT-LINE-10', joint: 'F1' }),
      makeRow({ id: 2, line: 'OTHER-LINE', joint: 'F2' }),
    ], new Set())

    fireEvent.click(screen.getByRole('button', { name: 'ВИК' }))
    fireEvent.change(screen.getByPlaceholderText('Проект, шифр, линия, спул или стык'), {
      target: { value: 'AUDIT-LINE-10' },
    })
    await waitFor(() => expect(screen.getByText('Найдено: 1 · Доступно: 1')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать доступные' }))

    expect(screen.getByRole('button', { name: 'Выбрано: 1' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /F1/ })).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Очистить' }))
    expect(screen.getByRole('checkbox', { name: /F2/ })).not.toBeChecked()
  })

  it('explains that a request must be created before adding a pre-heat-treatment result', async () => {
    await renderDialog('result', makeRow())

    fireEvent.change(screen.getByRole('combobox', { name: 'Метод контроля' }), {
      target: { value: 'ВИК' },
    })

    expect(screen.getAllByText(
      'Нет заявок ВИК до ТО, ожидающих результата. Сначала создайте заявку до ТО.',
    ).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Сохранить результат до ТО' })).toBeDisabled()
  })

  it('uses the same bulk-action prompt as the primary result dialog before a method is selected', async () => {
    await renderDialogRows('result', [makeRow()], new Set())

    expect(screen.getByRole('button', { name: 'Выберите метод' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Выбрать все доступные' })).not.toBeInTheDocument()
  })

  it('shows different results in the shared control when selected rows diverge', async () => {
    const request = {
      requestName: 'Заявка-ВИК-до-ТО-001',
      requestDate: '2026-08-20',
      result: 'ожидает НК',
    }
    await renderDialogRows('result', [
      makeRow({
        id: 1,
        joint: 'F1',
        preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ВИК', ...request }],
      }),
      makeRow({
        id: 2,
        joint: 'F2',
        preHeatTreatmentControls: [{ id: 2, weldJointId: 2, method: 'ВИК', ...request }],
      }),
    ])

    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /Выбрать стык/ })).toHaveLength(2))
    fireEvent.click(within(screen.getByRole('group', { name: 'Результат для всех выбранных' })).getByRole('button', { name: 'годен' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'ремонт' })[1]!)

    expect(screen.getByText('Разные результаты')).toBeInTheDocument()
  })
})
