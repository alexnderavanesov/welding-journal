import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { fireEvent, render as baseRender, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PreHeatTreatmentResultManagerDialog } from '@/components/pre-heat-treatment-result-manager-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'

const access = vi.hoisted(() => ({ canDelete: true }))
const documentStorage = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/security-context', () => ({ useAccess: () => ({ can: (permission: string) => permission !== 'lnk.delete' || access.canDelete }) }))
beforeEach(() => { access.canDelete = true; documentStorage.list.mockReset().mockResolvedValue({ rows: [], total: 0 }) })

const resultEditProps = () => ({
  pendingResultChanges: {}, pendingResultCount: 0,
  onStageResultChange: vi.fn(), onSaveChanges: vi.fn(), onResetChanges: vi.fn(),
})

describe('PreHeatTreatmentResultManagerDialog', () => {
  it.each(['request', 'result'] as const)('limits the %s document tab to all before-TO documents of selected joints', async registryMode => {
    const row = { id: 7, rowVersion: '107', line: 'L7', joint: 'F7', vikConclusion: 'Основное заключение',
      preHeatTreatmentControls: [
        { id: 11, weldJointId: 7, method: 'ВИК', requestName: 'З-ВИК', requestDate: '2026-08-04', result: 'годен', conclusionName: 'К-ВИК', conclusionDate: '2026-08-05' },
        { id: 12, weldJointId: 7, method: 'РК', requestName: 'З-РК', requestDate: '2026-08-04', result: 'годен', conclusionName: 'К-РК', conclusionDate: '2026-08-05' },
      ],
    } as WeldRow
    render(<PreHeatTreatmentResultManagerDialog {...resultEditProps()} rows={[row]} registryMode={registryMode} registryScope="selected" isPending={false}
      onClose={vi.fn()} onOpenWorkflow={vi.fn()} onCorrect={vi.fn()} onDeleteRequest={vi.fn()}
      onOpenDocument={vi.fn()} onOpenJournalRows={vi.fn()} onCopyDocumentName={vi.fn()} canOpenDocument={() => true} />)
    // A filter in the joint tab must not trim the documents of the selected joints.
    fireEvent.change(screen.getByLabelText('Вид контроля в реестре'), { target: { value: 'ВИК' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Документы' }))
    expect(await screen.findByText('Документы выбранных стыков')).toBeVisible()
    const list = within(screen.getByRole('complementary'))
    expect(list.getByRole('button', { name: new RegExp(registryMode === 'request' ? 'З-ВИК' : 'К-ВИК') })).toBeVisible()
    expect(list.getByRole('button', { name: new RegExp(registryMode === 'request' ? 'З-РК' : 'К-РК') })).toBeVisible()
    expect(list.queryByText('Основное заключение')).not.toBeInTheDocument()
    expect(documentStorage.list).not.toHaveBeenCalled()
  })
  it.each(['request', 'result'] as const)('explains missing delete permission in the %s card and menu while preserving requisite editing', registryMode => {
    access.canDelete = false
    const control = { id: 11, weldJointId: 7, method: 'ВИК', requestName: 'З-11', requestDate: '2026-08-04',
      result: registryMode === 'result' ? 'годен' : 'ожидает НК', conclusionDate: registryMode === 'result' ? '2026-08-05' : null,
      conclusionName: registryMode === 'result' ? 'К-11' : null }
    const row = { id: 7, rowVersion: '107', line: 'L7', joint: 'F7', preHeatTreatmentControls: [control] } as WeldRow
    const onDeleteRequest = vi.fn(), onStageResultChange = vi.fn(), onCorrect = vi.fn()
    render(<PreHeatTreatmentResultManagerDialog {...resultEditProps()} rows={[row]} registryMode={registryMode} isPending={false}
      onClose={vi.fn()} onOpenWorkflow={vi.fn()} onCorrect={onCorrect} onDeleteRequest={onDeleteRequest}
      onStageResultChange={onStageResultChange} onOpenDocument={vi.fn()} onOpenJournalRows={vi.fn()}
      onCopyDocumentName={vi.fn()} canOpenDocument={() => true} />)
  openEditors()
    const deleteLabel = registryMode === 'request' ? 'Удалить заявку' : 'Удалить результат'
    expect(screen.getByText('Нет права удаления в ЛНК. Обратитесь к администратору.')).toBeVisible()
    expect(screen.getByRole('button', { name: deleteLabel })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: deleteLabel }))
    expect(onDeleteRequest).not.toHaveBeenCalled()
    expect(onStageResultChange).not.toHaveBeenCalled()
    const input = screen.getByLabelText(registryMode === 'request' ? 'Заявка только этого стыка' : 'Заключение только этого стыка')
    fireEvent.change(input, { target: { value: 'Исправлено' } })
    fireEvent.click(screen.getByRole('button', { name: registryMode === 'request' ? 'Изменить заявку этого стыка' : 'Изменить заключение этого стыка' }))
    expect(onCorrect).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', relationId: 11 }))
    fireEvent.contextMenu(within(screen.getByRole('complementary')).getByText(registryMode === 'request' ? 'З-11' : 'К-11'))
    expect(within(screen.getByTestId('context-action-menu')).queryByRole('button', { name: deleteLabel })).not.toBeInTheDocument()
    expect(within(screen.getByTestId('context-action-menu')).getByRole('button', { name: 'Внести изменения' })).toBeVisible()
  })
  it.each(['request', 'result'] as const)('opens the %s row menu without offering a stage transfer', registryMode => {
    const row = { id: 7, joint: 'F7', line: 'L7',
      preHeatTreatmentControls: [{ id: 11, weldJointId: 7, method: 'ВИК',
        requestName: 'З-11', requestDate: '2026-08-04', result: 'годен',
        conclusionDate: '2026-08-05', conclusionName: 'К-11' }] } as WeldRow
    render(<PreHeatTreatmentResultManagerDialog {...resultEditProps()} rows={[row]} registryMode={registryMode} isPending={false}
      onClose={vi.fn()} onOpenWorkflow={vi.fn()} onCorrect={vi.fn()} onDeleteRequest={vi.fn()}
      onOpenDocument={vi.fn()} onOpenJournalRows={vi.fn()} onCopyDocumentName={vi.fn()} canOpenDocument={() => true} />)
  openEditors()
    fireEvent.contextMenu(within(screen.getByRole('complementary')).getByText(registryMode === 'request' ? 'З-11' : 'К-11'))
    const menu = screen.getByTestId('context-action-menu')
    expect(within(menu).getByRole('button', { name: registryMode === 'request' ? 'Внести изменения' : 'Внести изменения' })).toBeVisible()
    expect(within(menu).queryByRole('button', { name: /Изменить этап/ })).not.toBeInTheDocument()
  })

  it('shows the officiality warning next to the disabled result deletion', () => {
    const row = { id: 7, joint: 'F7', officiality: 'неофициальный',
      preHeatTreatmentControls: [{ id: 11, weldJointId: 7, method: 'УЗК', result: 'ремонт',
        requestName: 'З-11', conclusionDate: '2026-08-05', conclusionName: 'К-11' }] } as WeldRow
    const onStageResultChange = vi.fn()
    render(<PreHeatTreatmentResultManagerDialog {...resultEditProps()} rows={[row]} registryMode="result" isPending={false}
      onClose={vi.fn()} onOpenWorkflow={vi.fn()} onCorrect={vi.fn()} onDeleteRequest={vi.fn()} onStageResultChange={onStageResultChange}
      onOpenDocument={vi.fn()} onOpenJournalRows={vi.fn()} onCopyDocumentName={vi.fn()} canOpenDocument={() => true} />)
  openEditors()
    expect(screen.getByRole('button', { name: 'Удалить результат' })).toBeDisabled()
    expect(screen.getByText(/последний негодный результат/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить результат' }))
    expect(onStageResultChange).not.toHaveBeenCalled()
  })
  it('explains forbidden historical results without replacing them automatically', () => {
    const row = { id: 7, rowVersion: '107', joint: 'F7R2', d1: 57,
      preHeatTreatmentControls: [{ id: 11, weldJointId: 7, method: 'РК', result: 'ремонт',
        conclusionDate: '2026-08-05', conclusionName: 'РК-11' }] } as WeldRow
    const onCorrect = vi.fn()
    const onStageResultChange = vi.fn()
    render(<PreHeatTreatmentResultManagerDialog {...resultEditProps()} rows={[row]} registryMode="result" isPending={false}
      onClose={vi.fn()} onOpenWorkflow={vi.fn()} onCorrect={onCorrect} onDeleteRequest={vi.fn()} onStageResultChange={onStageResultChange}
      onOpenDocument={vi.fn()} onOpenJournalRows={vi.fn()} onCopyDocumentName={vi.fn()} canOpenDocument={() => true} />)
  openEditors()
    const picker = within(screen.getByRole('group', { name: 'Результат выбранного стыка' }))
    expect(picker.getByRole('button', { name: 'ремонт' })).toBeDisabled()
    expect(picker.getByRole('button', { name: 'ремонт' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.focus(screen.getByRole('group', { name: 'ремонт' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('меньше 89 мм')
    expect(screen.getByRole('tooltip')).toHaveTextContent('два ремонта')
    expect(screen.getByRole('link', { name: 'Подробнее о правиле СП-07' })).toHaveAttribute('href', '/settings#system-rule-lnk-results')
    expect(onCorrect).not.toHaveBeenCalled()
    fireEvent.click(picker.getByRole('button', { name: 'годен' }))
    expect(onStageResultChange).toHaveBeenCalledWith(row, row.preHeatTreatmentControls![0], {
      result: 'годен', conclusionName: 'РК-11', conclusionDate: '2026-08-05',
    })
    expect(onCorrect).not.toHaveBeenCalled()
  })
  it('shows a request without a result and allows correcting or deleting the request stage', () => {
    const onCorrect = vi.fn()
    const onDeleteRequest = vi.fn()
    const control = {
      id: 11,
      weldJointId: 7,
      method: 'ВИК',
      requestName: 'Заявка ВИК до ТО-001',
      requestDate: '2026-08-03',
      result: 'ожидает НК',
    }
    const row = {
      id: 7,
      rowVersion: '107',
      projectTitle: 'Проект А',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F7',
      connectionType: 'У17',
      preHeatTreatmentControls: [control],
    } as WeldRow

    render(
      <PreHeatTreatmentResultManagerDialog
        {...resultEditProps()}
        rows={[row]}
        registryMode="request"
        isPending={false}
        onClose={vi.fn()}
        onOpenWorkflow={vi.fn()}
        onCorrect={onCorrect}
        onDeleteRequest={onDeleteRequest}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onCopyDocumentName={vi.fn()}
        canOpenDocument={() => true}
      />,
    )
  openEditors()

    expect(screen.getByRole('heading', { name: 'Все заявки ЛНК до ТО' })).toBeInTheDocument()
    expect(screen.getByText('У17').parentElement).toHaveTextContent('Тип: У17')
    expect(screen.getByRole('dialog')).toHaveClass('max-w-[1480px]', 'h-[calc(100dvh-1rem)]')
    expect(screen.getByRole('button', { name: 'Новая заявка' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Название, дата, стык или линия')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Открыть документ' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Заявка только этого стыка'), {
      target: { value: 'Заявка ВИК до ТО исправлена' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Изменить заявку этого стыка' }))
    expect(onCorrect).toHaveBeenCalledWith({
      relationId: 11,
      expectedVersion: '107',
      stage: 'request',
      action: 'update',
      requestDate: '2026-08-03',
      requestName: 'Заявка ВИК до ТО исправлена',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Удалить заявку' }))
    expect(onDeleteRequest).toHaveBeenCalledWith(row, control)
  })

  it('shows only completed controls in the result registry and keeps the result-manager layout', () => {
    const completedControl = {
      id: 21,
      weldJointId: 8,
      method: 'ВИК',
      requestName: 'Заявка ВИК до ТО-002',
      requestDate: '2026-08-04',
      result: 'годен',
      conclusionDate: '2026-08-05',
      conclusionName: 'Заключение ВИК до ТО-002',
    }
    const pendingControl = {
      id: 22,
      weldJointId: 8,
      method: 'РК',
      requestName: 'Заявка РК до ТО-002',
      requestDate: '2026-08-04',
      result: 'ожидает НК',
    }
    const row = {
      id: 8,
      projectTitle: 'Проект А',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F8',
      connectionType: 'С17',
      preHeatTreatmentControls: [completedControl, pendingControl],
    } as WeldRow

    render(
      <PreHeatTreatmentResultManagerDialog
        {...resultEditProps()}
        rows={[row]}
        registryMode="result"
        isPending={false}
        onClose={vi.fn()}
        onOpenWorkflow={vi.fn()}
        onCorrect={vi.fn()}
        onDeleteRequest={vi.fn()}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onCopyDocumentName={vi.fn()}
        canOpenDocument={() => true}
      />,
    )
  openEditors()

    expect(screen.getByRole('heading', { name: 'Все результаты ЛНК до ТО' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Внести результаты' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Стык, линия, заявка или заключение')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Открыть документ' })).toBeInTheDocument()
    expect(within(screen.getByRole('complementary')).getByText('Заключение ВИК до ТО-002')).toBeInTheDocument()
    expect(screen.queryByText('Заявка РК до ТО-002')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Фильтр результатов' })).toBeInTheDocument()
  })

  it('keeps a large registry bounded and applies search after buffered input', async () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({
      id: index + 1,
      projectTitle: 'Проект А',
      subtitleCode: '400',
      line: `L-${index + 1}`,
      joint: `F${index + 1}`,
      preHeatTreatmentControls: [{
        id: index + 1000,
        weldJointId: index + 1,
        method: 'ВИК',
        requestName: `Заявка до ТО-${index + 1}`,
        requestDate: '2026-08-03',
        result: 'ожидает НК',
      }],
    })) as WeldRow[]

    render(
      <PreHeatTreatmentResultManagerDialog
        {...resultEditProps()}
        rows={rows}
        registryMode="request"
        isPending={false}
        onClose={vi.fn()}
        onOpenWorkflow={vi.fn()}
        onCorrect={vi.fn()}
        onDeleteRequest={vi.fn()}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onCopyDocumentName={vi.fn()}
        canOpenDocument={() => true}
      />,
    )
  openEditors()

    expect(screen.getAllByRole('button', { name: /Заявка до ТО-/ })).toHaveLength(12)
    expect(screen.queryByText('Заявка до ТО-120')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Название, дата, стык или линия'), {
      target: { value: 'Заявка до ТО-120' },
    })

    await waitFor(() => expect(screen.getByText('Найдено: 1')).toBeInTheDocument())
    expect(screen.getAllByText('Заявка до ТО-120').length).toBeGreaterThan(0)
  })

  it('repairs a request with no document identity through the local date and name fields', () => {
    const onCorrect = vi.fn()
    const control = {
      id: 31,
      weldJointId: 9,
      method: 'ВИК',
      requestName: '',
      requestDate: null,
      result: 'годен',
      conclusionDate: '2026-08-05',
      conclusionName: 'Заключение ВИК до ТО-009',
    }
    const row = {
      id: 9,
      rowVersion: '109',
      projectTitle: 'Проект А',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F9',
      preHeatTreatmentControls: [control],
    } as WeldRow

    render(
      <PreHeatTreatmentResultManagerDialog
        {...resultEditProps()}
        rows={[row]}
        registryMode="request"
        initialRelationId={control.id}
        rootCauseTarget={{
          kind: 'lnk-control',
          rowId: row.id,
          stage: 'beforeHeatTreatment',
          methodCode: 'ВИК',
          documentPart: 'request',
          focus: 'name',
          relationId: control.id,
        }}
        isPending={false}
        onClose={vi.fn()}
        onOpenWorkflow={vi.fn()}
        onCorrect={onCorrect}
        onDeleteRequest={vi.fn()}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onCopyDocumentName={vi.fn()}
        canOpenDocument={() => true}
      />,
    )
  openEditors()

    fireEvent.change(screen.getByLabelText('Дата заявки'), { target: { value: '2026-08-03' } })
    fireEvent.change(screen.getByLabelText('Заявка только этого стыка'), {
      target: { value: 'Заявка ВИК до ТО-009' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Изменить заявку этого стыка' }))

    expect(onCorrect).toHaveBeenCalledWith({
      relationId: 31,
      expectedVersion: '109',
      stage: 'request',
      action: 'update',
      requestDate: '2026-08-03',
      requestName: 'Заявка ВИК до ТО-009',
    })
  })
})

function openEditors() {
  for (const button of screen.queryAllByRole('button', { name: 'Редактировать' })) fireEvent.click(button)
}

vi.mock('@/lib/use-document-position-change', () => ({ useDocumentPositionChange: () => ({ save }: { save: () => void }) => save() }))
vi.mock('@/components/system-document-date-editor', () => ({ SystemDocumentDateEditor: ({ label, mode, onCompositionLoaded }: { label: string; mode?: string; onCompositionLoaded?: (count: number) => void }) => { useEffect(() => { onCompositionLoaded?.(2) }, [onCompositionLoaded]); return <div data-testid={mode === 'name' ? 'document-name-editor' : 'document-date-editor'}>{label}</div> } }))

const render = (ui: import('react').ReactNode, options?: import('@testing-library/react').RenderOptions) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return baseRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>, ...options })
}
vi.mock('@/lib/use-system-document-context', () => ({
  useSystemDocumentContext: () => ({ data: { rows: [{ id: 1 }, { id: 2 }], sourcePositions: [] }, isPending: false, isError: false }),
}))
vi.mock('@/lib/system-document-storage', () => ({ loadWorkflowDocumentHistoryGrid: documentStorage.list }))
