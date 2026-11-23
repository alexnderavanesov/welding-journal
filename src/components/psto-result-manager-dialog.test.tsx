import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render as baseRender, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PstoResultManagerDialog } from '@/components/psto-result-manager-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'

const access = vi.hoisted(() => ({ canDelete: true }))
const documents = vi.hoisted(() => ({ list: vi.fn(), context: vi.fn(), change: vi.fn(), confirm: vi.fn(), password: vi.fn() }))
vi.mock('@/lib/security-context', () => ({ useAccess: () => ({ can: (permission: string) => permission !== 'psto.delete' || access.canDelete }), useSecurityGuard: () => ({ requireEditPassword: documents.password }) }))
vi.mock('@/lib/confirm-action-context', () => ({ useConfirmAction: () => documents.confirm }))
vi.mock('@/server/weld-mutations-api', () => ({ changeSystemDocumentDate: documents.change }))
beforeEach(() => {
  access.canDelete = true
  documents.list.mockReset().mockResolvedValue({ rows: [], total: 0 })
  documents.context.mockReset().mockReturnValue({ data: { rows: [{ id: 1 }, { id: 2 }], sourcePositions: [] }, isPending: false, isError: false })
  documents.change.mockReset()
  documents.confirm.mockReset().mockResolvedValue(true)
  documents.password.mockReset().mockResolvedValue(true)
})

describe('PstoResultManagerDialog', () => {
  it('limits documents to all primary and repeat stages of selected joints', async () => {
    const row = { id: 7, pstoRequired: 'да',
      pstoRequest: 'ПСТО-1', pstoRequestDate: '2026-08-02', pstoResult: 'проведено', pstoDate: '2026-08-03', heatTreatmentDiagram: 'Д-1',
      tvmtRequest: 'ТВМТ-1', tvmtRequestDate: '2026-08-04', tvmtResult: 'не годен', tvmtConclusionDate: '2026-08-05', tvmtConclusion: 'К-1',
      pstoRepeatCycles: [{ id: 70, weldJointId: 7, sequence: 2,
        pstoRequest: 'ПСТО-2', pstoRequestDate: '2026-08-06', pstoResult: 'проведено', pstoDate: '2026-08-07', heatTreatmentDiagram: 'Д-2',
        tvmtRequest: 'ТВМТ-2', tvmtRequestDate: '2026-08-08', tvmtResult: 'годен', tvmtConclusionDate: '2026-08-09', tvmtConclusion: 'К-2',
      }],
    } as WeldRow
    render(<PstoResultManagerDialog rows={[row]} registryScope="selected" isPending={false} canOpenDocument={false}
      onClose={vi.fn()} onRenameDiagram={vi.fn()} onDeleteResult={vi.fn()}
      onOpenDocument={vi.fn()} onOpenJournalRows={vi.fn()} onCopyDocumentName={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'Повтор #2' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Документы' }))
    expect(await screen.findByText('Документы выбранных стыков')).toBeVisible()
    for (const [choice, first, repeat] of [
      ['psto-requests', 'ПСТО-1', 'ПСТО-2'], ['psto-results', 'Д-1', 'Д-2'],
      ['tvmt-requests', 'ТВМТ-1', 'ТВМТ-2'], ['tvmt-results', 'К-1', 'К-2'],
    ]) {
      fireEvent.change(screen.getByLabelText('Вид документа'), { target: { value: choice } })
      const list = within(screen.getByRole('complementary'))
      expect(list.getByRole('button', { name: new RegExp(first) })).toBeVisible()
      expect(list.getByRole('button', { name: new RegExp(repeat) })).toBeVisible()
      expect(list.getByText('Найдено документов: 2')).toBeVisible()
    }
    expect(documents.list).not.toHaveBeenCalled()
  })
  it('explains missing stage-delete permission and keeps request correction available', () => {
    access.canDelete = false
    const row = { id: 7, rowVersion: '107', pstoRequired: 'да', weldDate: '2026-08-01',
      pstoRequest: 'ПСТО-1', pstoRequestDate: '2026-08-02' } as WeldRow
    const onDeleteStage = vi.fn(), onCorrectStage = vi.fn()
    render(<PstoResultManagerDialog rows={[row]} isPending={false} canOpenDocument={false}
      onClose={vi.fn()} onRenameDiagram={vi.fn()} onDeleteResult={vi.fn()}
      onDeleteStage={onDeleteStage} onCorrectStage={onCorrectStage} onOpenDocument={vi.fn()}
      onOpenJournalRows={vi.fn()} onCopyDocumentName={vi.fn()} />)
  openEditors()
    const input = screen.getByRole('textbox', { name: 'Наименование заявки только этого стыка' })
    const card = input.closest('article')!
    expect(within(card).getByText(/Нет права удаления в ПСТО/)).toBeVisible()
    expect(within(card).getByRole('button', { name: 'Удалить этап' })).toBeDisabled()
    fireEvent.change(input, { target: { value: 'ПСТО-исправлено' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Сохранить изменения' }))
    expect(onCorrectStage).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', name: 'ПСТО-исправлено' }))
    fireEvent.contextMenu(card)
    expect(within(screen.getByTestId('context-action-menu')).queryByRole('button', { name: /^Удалить:/ })).not.toBeInTheDocument()
    expect(within(screen.getByTestId('context-action-menu')).getByRole('button', { name: 'Внести изменения' })).toBeVisible()
    expect(onDeleteStage).not.toHaveBeenCalled()
  })
  it('preserves the selected repeat while server search temporarily clears the rows', () => {
    const row = { preHeatTreatmentMode: 'allPsto' as const,
      id: 7, pstoRequired: 'да', pstoRequest: 'ПСТО-1',
      pstoRepeatCycles: [{ id: 70, weldJointId: 7, sequence: 2, pstoRequest: 'ПСТО-2', pstoRequestDate: '2026-10-30' }],
    } as WeldRow
    const props = {
      isPending: false, canOpenDocument: false,
      onClose: vi.fn(), onRenameDiagram: vi.fn(),
      onDeleteResult: vi.fn(), onOpenDocument: vi.fn(), onOpenJournalRows: vi.fn(), onCopyDocumentName: vi.fn(),
    }
    const { rerender } = render(<PstoResultManagerDialog {...props} rows={[row]} />)
    expect(screen.getByRole('tab', { name: 'Повтор #2' })).toHaveAttribute('aria-selected', 'true')
    rerender(<PstoResultManagerDialog {...props} rows={[]} />)
    rerender(<PstoResultManagerDialog {...props} rows={[row]} />)
    expect(screen.getByRole('tab', { name: 'Повтор #2' })).toHaveAttribute('aria-selected', 'true')
    openEditors()
    expect(screen.getByRole('textbox', { name: 'Наименование заявки только этого стыка' })).toHaveValue('ПСТО-2')
  })

  it.each(['Заявка ПСТО', 'Результат ПСТО', 'Заявка ТВМТ', 'Заключение ТВМТ'])('does not reopen folded %s after search temporarily clears the rows', label => {
    const row = { id: 7, pstoRequired: 'да', pstoRequest: 'ПСТО-1',
      pstoRepeatCycles: [{ id: 70, weldJointId: 7, sequence: 2,
        pstoRequest: 'ПСТО-2', pstoRequestDate: '2026-08-02', pstoResult: 'проведено', pstoDate: '2026-08-03', heatTreatmentDiagram: 'Д-2',
        tvmtRequest: 'ТВМТ-2', tvmtRequestDate: '2026-08-04', tvmtResult: 'годен', tvmtConclusionDate: '2026-08-05', tvmtConclusion: 'К-2',
      }],
    } as WeldRow
    const props = {
      isPending: false, canOpenDocument: false,
      onClose: vi.fn(), onRenameDiagram: vi.fn(),
      onDeleteResult: vi.fn(), onOpenDocument: vi.fn(), onOpenJournalRows: vi.fn(), onCopyDocumentName: vi.fn(),
    }
    const { rerender } = render(<PstoResultManagerDialog {...props} rows={[row]} />)
    const card = () => within(screen.getByRole('heading', { name: label }).closest('article')!)
    fireEvent.contextMenu(screen.getByRole('heading', { name: label }))
    fireEvent.click(within(screen.getByTestId('context-action-menu')).getByRole('button', { name: 'Внести изменения' }))
    expect(card().getByRole('button', { name: 'К документу' })).toBeVisible()
    fireEvent.click(card().getByRole('button', { name: 'Свернуть редактирование' }))
    expect(card().getByRole('button', { name: 'Редактировать' })).toBeVisible()
    rerender(<PstoResultManagerDialog {...props} rows={[]} />)
    rerender(<PstoResultManagerDialog {...props} rows={[row]} />)
    expect(card().getByRole('button', { name: 'Редактировать' })).toBeVisible()
    expect(card().queryByRole('button', { name: 'К документу' })).not.toBeInTheDocument()
    // A new explicit menu command still opens the same stage.
    fireEvent.contextMenu(screen.getByRole('heading', { name: label }))
    fireEvent.click(within(screen.getByTestId('context-action-menu')).getByRole('button', { name: 'Внести изменения' }))
    expect(card().getByRole('button', { name: 'К документу' })).toBeVisible()
  })

  it.each(['cancel', 'save'])('blocks a whole-document name save until a changed TVMT position is resolved by %s', async resolution => {
    const row = { id: 7, rowVersion: '107', joint: 'F7', line: 'L7', weldDate: '2026-08-01', pstoRequired: 'да',
      pstoRequest: 'ПСТО-1', pstoRequestDate: '2026-08-02', pstoResult: 'проведено', pstoDate: '2026-08-03', heatTreatmentDiagram: 'Д-1',
      tvmtRequest: 'ТВМТ-1', tvmtRequestDate: '2026-08-04', tvmtResult: 'годен', tvmtConclusionDate: '2026-08-05', tvmtConclusion: 'К-1',
    } as WeldRow
    const context = (record: WeldRow) => ({ data: { rows: [record], sourcePositions: [{ kind: 'pstoCycle', weldJointId: 7, relationId: 7, sequence: 1, methodCode: 'ТВМТ' }] }, isPending: false, isError: false })
    documents.context.mockReturnValue(context(row))
    const props = {
      isPending: false, canOpenDocument: false, onCorrectStage: vi.fn(),
      onClose: vi.fn(), onRenameDiagram: vi.fn(),
      onDeleteResult: vi.fn(), onOpenDocument: vi.fn(), onOpenJournalRows: vi.fn(), onCopyDocumentName: vi.fn(),
    }
    const { rerender } = render(<PstoResultManagerDialog {...props} rows={[row]} />)
    openEditors()
    const card = () => within(screen.getByRole('heading', { name: 'Заключение ТВМТ' }).closest('article')!)
    fireEvent.click(card().getByRole('button', { name: 'К документу' }))
    const name = await screen.findByLabelText('Название документа')
    await waitFor(() => expect(name).toBeEnabled())
    fireEvent.change(name, { target: { value: 'Обновлённое заключение ТВМТ' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Обновить список' })).toBeEnabled())
    const initialRegistryReads = documents.list.mock.calls.length
    fireEvent.click(screen.getByRole('tab', { name: 'Стыки' }))
    fireEvent.change(card().getByLabelText('Результат'), { target: { value: 'не годен' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Документы' }))
    const save = screen.getByRole('button', { name: 'Сохранить изменения документа' })
    expect(save).toBeDisabled()
    expect(name).toBeDisabled()
    expect(screen.getByText('Сначала сохраните или отмените изменения позиции на вкладке «Стыки».')).toBeVisible()
    fireEvent.click(save)
    expect(documents.change).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Стыки' }))
    expect(card().getByLabelText('Результат')).toHaveValue('не годен')
    if (resolution === 'cancel') {
      fireEvent.click(card().getByRole('button', { name: 'Отменить изменения' }))
      expect(card().getByLabelText('Результат')).toHaveValue('годен')
    } else {
      fireEvent.click(card().getByRole('button', { name: 'Сохранить изменения' }))
      expect(props.onCorrectStage).toHaveBeenCalledWith(expect.objectContaining({ stage: 'tvmtResult', result: 'не годен' }))
      const saved = { ...row, tvmtResult: 'не годен', rowVersion: '108' }
      documents.context.mockReturnValue(context(saved))
      rerender(<PstoResultManagerDialog {...props} rows={[saved]} />)
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Документы' }))
    await waitFor(() => expect(save).toBeEnabled())
    expect(name).toHaveValue('Обновлённое заключение ТВМТ')
    expect(documents.list).toHaveBeenCalledTimes(initialRegistryReads)
  })

  it('does not present a missing TVMT result as good and allows restoring it explicitly', () => {
    const onCorrectStage = vi.fn()
    const row = { preHeatTreatmentMode: 'allPsto' as const,
      id: 7,
      rowVersion: '107',
      projectTitle: 'Проект А',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F7',
      connectionType: 'С17',
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      pstoRequest: 'ПСТО-1',
      pstoRequestDate: '2026-08-02',
      pstoResult: 'проведено',
      pstoDate: '2026-08-03',
      heatTreatmentDiagram: 'Диаграмма-1',
      tvmtRequest: 'ТВМТ-1',
      tvmtRequestDate: '2026-08-04',
      tvmtResult: null,
      tvmtConclusionDate: '2026-08-05',
      tvmtConclusion: 'Заключение-ТВМТ-1',
    } as WeldRow

    render(
      <PstoResultManagerDialog
        rows={[row]}
        isPending={false}
        canOpenDocument={false}
        onClose={vi.fn()}
        onRenameDiagram={vi.fn()}
        onDeleteResult={vi.fn()}
        onCorrectStage={onCorrectStage}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onCopyDocumentName={vi.fn()}
      />,
    )
  openEditors()

    expect(screen.getByText('С17').parentElement).toHaveTextContent('Тип: С17')
    expect(screen.getByText('Результат: -')).toBeInTheDocument()
    const resultSelect = screen.getByLabelText('Результат')
    const resultArticle = resultSelect.closest('article')
    expect(resultArticle).not.toBeNull()
    const saveButton = within(resultArticle!).getByRole('button', { name: 'Сохранить изменения' })
    expect(resultSelect).toHaveValue('')
    expect(saveButton).toBeDisabled()

    fireEvent.change(resultSelect, { target: { value: 'не годен' } })
    fireEvent.click(saveButton)

    expect(onCorrectStage).toHaveBeenCalledWith({
      rowId: 7,
      expectedVersion: '107',
      sequence: 1,
      cycleId: undefined,
      stage: 'tvmtResult',
      action: 'update',
      date: '2026-08-05',
      name: 'Заключение-ТВМТ-1',
      result: 'не годен',
    })
  })

  it('blocks changing the latest good TVMT to failed after post-heat-treatment LNK exists', () => {
    const onCorrectStage = vi.fn()
    const row = { preHeatTreatmentMode: 'allPsto' as const,
      id: 8,
      rowVersion: '108',
      projectTitle: 'Проект А',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F8',
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      hasVik: 'да',
      pstoRequest: 'ПСТО-1',
      pstoRequestDate: '2026-08-02',
      pstoResult: 'проведено',
      pstoDate: '2026-08-03',
      heatTreatmentDiagram: 'Диаграмма-1',
      tvmtRequest: 'ТВМТ-1',
      tvmtRequestDate: '2026-08-04',
      tvmtResult: 'не годен',
      tvmtConclusionDate: '2026-08-05',
      tvmtConclusion: 'Заключение-ТВМТ-1',
      pstoRepeatCycles: [{
        id: 22,
        weldJointId: 8,
        sequence: 2,
        pstoRequest: 'ПСТО-2',
        pstoRequestDate: '2026-08-06',
        pstoResult: 'проведено',
        pstoDate: '2026-08-07',
        heatTreatmentDiagram: 'Диаграмма-2',
        tvmtRequest: 'ТВМТ-2',
        tvmtRequestDate: '2026-08-08',
        tvmtResult: 'годен',
        tvmtConclusionDate: '2026-08-09',
        tvmtConclusion: 'Заключение-ТВМТ-2',
      }],
      vikRequest: 'Заявка ВИК',
      vikRequestDate: '2026-08-10',
      vikResult: 'годен',
      vikConclusionDate: '2026-08-10',
      vikConclusion: 'Заключение ВИК',
    } as WeldRow

    render(
      <PstoResultManagerDialog
        rows={[row]}
        isPending={false}
        canOpenDocument={false}
        onClose={vi.fn()}
        onRenameDiagram={vi.fn()}
        onDeleteResult={vi.fn()}
        onCorrectStage={onCorrectStage}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onCopyDocumentName={vi.fn()}
      />,
    )
  openEditors()

    const resultSelect = screen.getByLabelText('Результат')
    const resultArticle = resultSelect.closest('article')
    expect(resultArticle).not.toBeNull()
    const saveButton = within(resultArticle!).getByRole('button', { name: 'Сохранить изменения' })

    fireEvent.change(resultSelect, { target: { value: 'не годен' } })

    expect(saveButton).toBeDisabled()
    expect(within(resultArticle!).getByText(/Сохранение заблокировано:.*ВИК после ТО/)).toBeInTheDocument()
    fireEvent.click(saveButton)
    expect(onCorrectStage).not.toHaveBeenCalled()
  })

  it('keeps a long TVMT conclusion inside the card and opens the repeat cycle blocking a correction', () => {
    const onCorrectTvmtAndRemoveLaterCycles = vi.fn()
    const row = { preHeatTreatmentMode: 'allPsto' as const,
      id: 9,
      rowVersion: '109',
      projectTitle: 'Проект А',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F9',
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      pstoRequest: 'ПСТО-1',
      pstoRequestDate: '2026-08-02',
      pstoResult: 'проведено',
      pstoDate: '2026-08-03',
      heatTreatmentDiagram: 'Диаграмма-1',
      tvmtRequest: 'ТВМТ-1',
      tvmtRequestDate: '2026-08-04',
      tvmtResult: 'не годен',
      tvmtConclusionDate: '2026-08-05',
      tvmtConclusion: 'ЗНК-ТВМТ-29.08.2026-001',
      pstoRepeatCycles: [{
        id: 23,
        weldJointId: 9,
        sequence: 2,
        pstoRequest: 'ПСТО-2',
        pstoRequestDate: '2026-08-06',
        pstoResult: 'проведено',
        pstoDate: '2026-08-07',
        heatTreatmentDiagram: 'Диаграмма-2',
        tvmtRequest: 'ТВМТ-2',
        tvmtRequestDate: '2026-08-08',
        tvmtResult: 'годен',
        tvmtConclusionDate: '2026-08-09',
        tvmtConclusion: 'ЗНК-ТВМТ-29.08.2026-002',
      }],
    } as WeldRow

    render(
      <PstoResultManagerDialog
        rows={[row]}
        isPending={false}
        canOpenDocument={false}
        onClose={vi.fn()}
        onRenameDiagram={vi.fn()}
        onDeleteResult={vi.fn()}
        onCorrectStage={vi.fn()}
        onCorrectTvmtAndRemoveLaterCycles={onCorrectTvmtAndRemoveLaterCycles}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onCopyDocumentName={vi.fn()}
      />,
    )
  openEditors()

    const repeatTab = screen.getByRole('tab', { name: 'Повтор #2' })
    expect(repeatTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Наименование заключения только этого стыка').closest('label')).toHaveClass('sm:col-span-2')

    fireEvent.click(screen.getByRole('tab', { name: 'Основной цикл' }))
    openEditors()
    fireEvent.change(screen.getByLabelText('Результат'), { target: { value: 'годен' } })

    expect(screen.getByText(/Сохранение заблокировано:.*сначала удалите этапы цикла #2/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить последующие циклы и сохранить' }))
    expect(onCorrectTvmtAndRemoveLaterCycles).toHaveBeenCalledWith(row, {
      rowId: 9,
      expectedVersion: '109',
      sequence: 1,
      cycleId: undefined,
      date: '2026-08-05',
      name: 'ЗНК-ТВМТ-29.08.2026-001',
      result: 'годен',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Просмотреть цикл №2' }))

    expect(repeatTab).toHaveAttribute('aria-selected', 'true')
    openEditors()
    expect(screen.getByLabelText('Наименование заключения только этого стыка')).toHaveValue('ЗНК-ТВМТ-29.08.2026-002')
  })

  it('shows the missing requested stage and repairs its date and name together', () => {
    const onCorrectStage = vi.fn()
    const row = { preHeatTreatmentMode: 'allPsto' as const,
      id: 10,
      rowVersion: '110',
      projectTitle: 'Проект А',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F10',
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      pstoResult: 'проведено',
      pstoDate: '2026-08-04',
      heatTreatmentDiagram: 'Диаграмма-10',
    } as WeldRow

    render(
      <PstoResultManagerDialog
        rows={[row]}
        isPending={false}
        canOpenDocument={false}
        initialRowId={row.id}
        initialSequence={1}
        initialStage="pstoRequest"
        rootCauseTarget={{
          kind: 'psto-cycle',
          rowId: row.id,
          sequence: 1,
          stage: 'pstoRequest',
          focus: 'name',
        }}
        onClose={vi.fn()}
        onRenameDiagram={vi.fn()}
        onDeleteResult={vi.fn()}
        onCorrectStage={onCorrectStage}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onCopyDocumentName={vi.fn()}
      />,
    )
  openEditors()

    const requestCard = screen.getByRole('heading', { name: 'Заявка ПСТО' }).closest('article')
    expect(requestCard).not.toBeNull()
    fireEvent.change(within(requestCard!).getByLabelText('Дата'), {
      target: { value: '2026-08-02' },
    })
    fireEvent.change(within(requestCard!).getByLabelText('Наименование заявки только этого стыка'), {
      target: { value: 'ПСТО-10' },
    })
    fireEvent.click(within(requestCard!).getByRole('button', { name: 'Сохранить изменения' }))

    expect(onCorrectStage).toHaveBeenCalledWith({
      rowId: 10,
      expectedVersion: '110',
      sequence: 1,
      cycleId: undefined,
      stage: 'pstoRequest',
      action: 'update',
      date: '2026-08-02',
      name: 'ПСТО-10',
      result: '',
    })
  })
})

function openEditors() {
  for (const button of screen.queryAllByRole('button', { name: 'Редактировать' })) fireEvent.click(button)
}

vi.mock('@/lib/use-document-position-change', () => ({ useDocumentPositionChange: () => ({ save }: { save: () => void }) => save() }))

const render = (ui: import('react').ReactNode, options?: import('@testing-library/react').RenderOptions) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return baseRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>, ...options })
}
vi.mock('@/lib/use-system-document-context', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/use-system-document-context')>(), useSystemDocumentContext: documents.context,
}))
vi.mock('@/lib/system-document-storage', () => ({ loadWorkflowDocumentHistoryGrid: documents.list }))
