import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PreHeatTreatmentResultManagerDialog } from '@/components/pre-heat-treatment-result-manager-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('PreHeatTreatmentResultManagerDialog', () => {
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
      preHeatTreatmentControls: [control],
    } as WeldRow

    render(
      <PreHeatTreatmentResultManagerDialog
        rows={[row]}
        registryMode="request"
        isPending={false}
        onClose={vi.fn()}
        onOpenWorkflow={vi.fn()}
        onCorrect={onCorrect}
        onDeleteRequest={onDeleteRequest}
        onDeleteResult={vi.fn()}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onCopyDocumentName={vi.fn()}
        canOpenDocument={() => true}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Редактирование заявок ЛНК до ТО' })).toBeInTheDocument()
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
      preHeatTreatmentControls: [completedControl, pendingControl],
    } as WeldRow

    render(
      <PreHeatTreatmentResultManagerDialog
        rows={[row]}
        registryMode="result"
        isPending={false}
        onClose={vi.fn()}
        onOpenWorkflow={vi.fn()}
        onCorrect={vi.fn()}
        onDeleteRequest={vi.fn()}
        onDeleteResult={vi.fn()}
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
        rows={rows}
        registryMode="request"
        isPending={false}
        onClose={vi.fn()}
        onOpenWorkflow={vi.fn()}
        onCorrect={vi.fn()}
        onDeleteRequest={vi.fn()}
        onDeleteResult={vi.fn()}
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
})
