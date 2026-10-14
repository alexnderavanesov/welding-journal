import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PreHeatTreatmentResultManagerDialog } from '@/components/pre-heat-treatment-result-manager-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'

const resultEditProps = () => ({
  pendingResultChanges: {}, pendingResultCount: 0,
  onStageResultChange: vi.fn(), onSaveChanges: vi.fn(), onResetChanges: vi.fn(),
})

describe('PreHeatTreatmentResultManagerDialog', () => {
  it.each(['request', 'result'] as const)('opens the %s row menu without offering a stage transfer', registryMode => {
    const row = { id: 7, joint: 'F7', line: 'L7',
      preHeatTreatmentControls: [{ id: 11, weldJointId: 7, method: 'ВИК',
        requestName: 'З-11', requestDate: '2026-08-04', result: 'годен',
        conclusionDate: '2026-08-05', conclusionName: 'К-11' }] } as WeldRow
    render(<PreHeatTreatmentResultManagerDialog {...resultEditProps()} rows={[row]} registryMode={registryMode} isPending={false}
      onClose={vi.fn()} onOpenWorkflow={vi.fn()} onCorrect={vi.fn()} onDeleteRequest={vi.fn()}
      onOpenDocument={vi.fn()} onOpenJournalRows={vi.fn()} onCopyDocumentName={vi.fn()} canOpenDocument={() => true} />)
    fireEvent.contextMenu(within(screen.getByRole('complementary')).getByText(registryMode === 'request' ? 'З-11' : 'К-11'))
    const menu = screen.getByTestId('context-action-menu')
    expect(within(menu).getByRole('button', { name: registryMode === 'request' ? 'Изменить дату заявки' : 'Изменить дату заключения' })).toBeVisible()
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
    const picker = within(screen.getByRole('group', { name: 'Результат' }))
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

    expect(screen.getByRole('heading', { name: 'Редактирование заявок ЛНК до ТО' })).toBeInTheDocument()
    expect(screen.getByText('У17').parentElement).toHaveTextContent('Тип: У17')
    expect(screen.getByRole('dialog')).toHaveClass('max-w-[1480px]', 'h-[calc(100dvh-1rem)]')
    expect(screen.getByRole('button', { name: 'Новая заявка' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Название, дата, стык или линия')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Открыть документ' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Наименование заявки'), {
      target: { value: 'Заявка ВИК до ТО исправлена' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить заявку' }))
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

    expect(screen.getByRole('heading', { name: 'Редактирование результатов ЛНК до ТО' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Внести результаты' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Стык, линия, заявка или заключение')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Открыть документ' })).toBeInTheDocument()
    expect(screen.getByText('Заключение ВИК до ТО-002')).toBeInTheDocument()
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

    fireEvent.change(screen.getByLabelText('Дата заявки'), { target: { value: '2026-08-03' } })
    fireEvent.change(screen.getByLabelText('Наименование заявки'), {
      target: { value: 'Заявка ВИК до ТО-009' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить заявку' }))

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
