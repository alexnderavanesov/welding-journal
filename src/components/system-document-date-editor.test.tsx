import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SystemDocumentDateEditor,
  type SystemDocumentDateEditorProps,
} from '@/components/system-document-date-editor'
import type { WeldRow } from '@/lib/dispatcher-types'

const mocks = vi.hoisted(() => ({
  changeDate: vi.fn(),
  confirm: vi.fn(),
  invalidateWeldJoints: vi.fn(),
  loadRows: vi.fn(),
  requireEditPassword: vi.fn(),
}))

vi.mock('@/lib/system-document-storage', () => ({
  loadSystemDocumentDateContext: mocks.loadRows,
}))

vi.mock('@/lib/weld-query-utils', () => ({
  invalidateWeldJoints: mocks.invalidateWeldJoints,
}))

vi.mock('@/server/weld-mutations-api', () => ({
  changeSystemDocumentDate: mocks.changeDate,
}))

vi.mock('@/lib/confirm-action-context', () => ({
  useConfirmAction: () => mocks.confirm,
}))

vi.mock('@/lib/security-context', () => ({
  useSecurityGuard: () => ({ requireEditPassword: mocks.requireEditPassword }),
}))

describe('SystemDocumentDateEditor', () => {
  beforeEach(() => {
    mocks.changeDate.mockReset()
    mocks.confirm.mockReset().mockResolvedValue(true)
    mocks.invalidateWeldJoints.mockReset()
    mocks.loadRows.mockReset()
    mocks.requireEditPassword.mockReset().mockResolvedValue(true)
  })

  it('previews consequences and sends one versioned whole-document mutation', async () => {
    const rows = [
      row(1, {
        vikRequest: 'Заявка-09.08.2026-007',
        vikRequestDate: '2026-08-09',
        rkRequest: 'Заявка-09.08.2026-007',
        rkRequestDate: '2026-08-09',
      }),
      row(2, {
        uzkRequest: 'Заявка-09.08.2026-007',
        uzkRequestDate: '2026-08-09',
      }),
    ]
    mocks.loadRows.mockResolvedValue({ rows, sourcePositions: [] })
    mocks.changeDate.mockResolvedValue({
      nextReference: {
        type: 'lnkRequest',
        title: 'Заявка-10.08.2026-007',
        date: '2026-08-10',
      },
      previousTitle: 'Заявка-09.08.2026-007',
      nextTitle: 'Заявка-10.08.2026-007',
      previousDate: '2026-08-09',
      nextDate: '2026-08-10',
      isSystemName: true,
      rowCount: 2,
      positionCount: 3,
      rows,
    })
    const onSaved = vi.fn()
    const onMessage = vi.fn()

    renderEditor({ onSaved, onMessage })
    const input = await screen.findByLabelText('Дата заявки ЛНК')
    expect(mocks.loadRows).toHaveBeenCalledTimes(1)
    fireEvent.change(input, { target: { value: '2026-08-10' } })

    expect(await screen.findByText(/Будет изменено позиций: 3; стыков: 2/)).toHaveTextContent(
      'Системное имя сохранит номер и станет «Заявка-10.08.2026-007»',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Изменить дату' }))

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Новая дата будет записана сразу во все позиции документа: 3 поз. в 2 ст.',
      warning: 'Системное имя будет пересчитано с сохранением номера: «Заявка-10.08.2026-007».',
    })))
    await waitFor(() => expect(mocks.changeDate).toHaveBeenCalledWith({
      data: {
        reference: {
          type: 'lnkRequest',
          title: 'Заявка-09.08.2026-007',
          date: '2026-08-09',
        },
        nextDate: '2026-08-10',
        expectedVersions: [
          { id: 1, version: 'v1' },
          { id: 2, version: 'v2' },
        ],
      },
    }))
    expect(mocks.requireEditPassword).toHaveBeenCalledWith('изменение даты документа')
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(mocks.invalidateWeldJoints).toHaveBeenCalledWith(
      expect.any(QueryClient),
      { upsertRows: rows },
      { refetchLnkWorkflow: true },
    )
    expect(onMessage).toHaveBeenCalledWith(expect.stringContaining('3 позиций (2 стыков)'))
    expect(mocks.loadRows).toHaveBeenCalledTimes(1)
  })

  it('blocks the mutation and exposes every exact next action for a new chronology conflict', async () => {
    const current = row(5, {
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО',
      pstoRequestDate: '2026-08-20',
      pstoResult: 'проведено',
      pstoDate: '2026-08-29',
      heatTreatmentDiagram: 'Диаграмма ПСТО',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtRequestDate: '2026-08-29',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-30',
      tvmtConclusion: 'Заключение ТВМТ',
      hasVik: 'да',
      vikRequest: 'Заявка-30.08.2026-007',
      vikRequestDate: '2026-08-30',
    })
    mocks.loadRows.mockResolvedValue({ rows: [current], sourcePositions: [] })
    const onRunRootCauseAction = vi.fn()

    renderEditor({
      reference: {
        type: 'lnkRequest',
        title: 'Заявка-30.08.2026-007',
        date: '2026-08-30',
        methodCode: 'ВИК',
      },
      onRunRootCauseAction,
    })
    const input = await screen.findByLabelText('Дата заявки ЛНК')
    fireEvent.change(input, { target: { value: '2026-08-09' } })

    expect(await screen.findByText(/Сохранение заблокировано/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Изменить дату' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Исправить дату заявки ВИК' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Исправить дату ПСТО' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Исправить дату заключения ТВМТ' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Исправить дату заявки ВИК' }))
    expect(input).toHaveFocus()
    expect(onRunRootCauseAction).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Исправить дату ПСТО' }))
    expect(onRunRootCauseAction).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({
        kind: 'psto-cycle',
        rowId: 5,
        sequence: 1,
        stage: 'pstoResult',
        documentDate: '2026-08-29',
      }),
    }))
    expect(mocks.changeDate).not.toHaveBeenCalled()
  })

  it('reuses real source rows for a second sourced document date change', async () => {
    const previousReference: SystemDocumentDateEditorProps['reference'] = {
      type: 'pstoConclusion',
      title: 'Диаграмма цикла 2',
      date: '2026-08-09',
      sourceKind: 'pstoCycle',
      cycleSequences: [2],
    }
    const nextReference = { ...previousReference, date: '2026-08-10' }
    const sourcePositions = [{
      kind: 'pstoCycle' as const,
      weldJointId: 7,
      relationId: 72,
      sequence: 2,
    }]
    const previousRealRows = [row(7, {
      heatTreatmentDiagram: 'Диаграмма основного цикла',
      pstoDate: '2026-08-01',
      pstoRepeatCycles: [{
        id: 72,
        weldJointId: 7,
        sequence: 2,
        heatTreatmentDiagram: previousReference.title,
        pstoDate: previousReference.date,
      }],
    })]
    const savedRealRows = [row(7, {
      heatTreatmentDiagram: 'Диаграмма основного цикла',
      pstoDate: '2026-08-01',
      rowVersion: 'v7-next',
      pstoRepeatCycles: [{
        id: 72,
        weldJointId: 7,
        sequence: 2,
        heatTreatmentDiagram: nextReference.title,
        pstoDate: nextReference.date,
      }],
    })]
    mocks.loadRows.mockResolvedValue({
      rows: previousRealRows,
      sourcePositions,
    })
    mocks.changeDate.mockResolvedValue({
      nextReference,
      previousTitle: previousReference.title,
      nextTitle: nextReference.title,
      previousDate: previousReference.date,
      nextDate: nextReference.date,
      isSystemName: false,
      rowCount: 1,
      positionCount: 1,
      rows: savedRealRows,
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const onSaved = vi.fn()
    const view = render(
      <QueryClientProvider client={queryClient}>
        <SystemDocumentDateEditor
          reference={previousReference}
          label="Дата ПСТО"
          onSaved={onSaved}
        />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Дата ПСТО'), {
      target: { value: nextReference.date },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Изменить дату' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(mocks.invalidateWeldJoints).toHaveBeenLastCalledWith(
      queryClient,
      { upsertRows: savedRealRows },
      { refetchLnkWorkflow: false },
    )

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <SystemDocumentDateEditor
          reference={nextReference}
          label="Дата ПСТО"
        />
      </QueryClientProvider>,
    )
    expect(mocks.loadRows).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Дата ПСТО'), {
      target: { value: '2026-08-11' },
    })

    expect(await screen.findByText(/Будет изменено позиций: 1; стыков: 1/)).toBeInTheDocument()
  })
})

function renderEditor({
  reference = DEFAULT_REFERENCE,
  onSaved = vi.fn(),
  onMessage = vi.fn(),
  onRunRootCauseAction = vi.fn(),
}: Partial<Pick<
  SystemDocumentDateEditorProps,
  'reference' | 'onSaved' | 'onMessage' | 'onRunRootCauseAction'
>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SystemDocumentDateEditor
        reference={reference}
        label="Дата заявки ЛНК"
        onSaved={onSaved}
        onMessage={onMessage}
        onRunRootCauseAction={onRunRootCauseAction}
      />
    </QueryClientProvider>,
  )
}

const DEFAULT_REFERENCE: SystemDocumentDateEditorProps['reference'] = {
  type: 'lnkRequest',
  title: 'Заявка-09.08.2026-007',
  date: '2026-08-09',
}

function row(id: number, overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id,
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'L-1',
    joint: `F${id}`,
    weldDate: '2026-08-01',
    rowVersion: `v${id}`,
    ...overrides,
  } as WeldRow
}
