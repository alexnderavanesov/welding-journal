import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SystemDocumentDateEditor,
  type SystemDocumentDateEditorProps,
} from '@/components/system-document-date-editor'
import type { WeldRow } from '@/lib/dispatcher-types'
import { documentContextKey } from '@/lib/use-system-document-context'
import * as documentPlans from '@/lib/system-document-date-change'
import * as chronologyActions from '@/lib/workflow-root-cause-actions'

const mocks = vi.hoisted(() => ({
  changeDate: vi.fn(),
  confirm: vi.fn(),
  scheduleWeldDataRefresh: vi.fn(),
  loadRows: vi.fn(),
  can: vi.fn(),
}))

vi.mock('@/lib/system-document-storage', () => ({
  loadSystemDocumentDateContext: mocks.loadRows,
}))

vi.mock('@/lib/weld-query-utils', () => ({
  scheduleWeldDataRefresh: mocks.scheduleWeldDataRefresh,
}))

vi.mock('@/server/weld-mutations-api', () => ({
  changeSystemDocumentDate: mocks.changeDate,
}))

vi.mock('@/lib/confirm-action-context', () => ({
  useConfirmAction: () => mocks.confirm,
}))

vi.mock('@/lib/security-context', () => ({ useAccess: () => ({ can: mocks.can }) }))

describe('SystemDocumentDateEditor', () => {
  afterEach(() => vi.restoreAllMocks())
  beforeEach(() => {
    mocks.changeDate.mockReset()
    mocks.confirm.mockReset().mockResolvedValue(true)
    mocks.scheduleWeldDataRefresh.mockReset()
    mocks.loadRows.mockReset()
    mocks.can.mockReset().mockReturnValue(true)
  })

  it.each([
    { type: 'lnkRequest', area: 'lnk' },
    { type: 'lnkConclusion', methodCode: 'ТВМТ', area: 'psto' },
    { type: 'pstoConclusion', area: 'psto' },
  ] as const)('blocks metadata without $area edit even when documents.edit is available', async ({ area, ...identity }) => {
    mocks.can.mockImplementation((permission: string) => permission !== `${area}.edit`)
    mocks.loadRows.mockResolvedValue({ rows: [], sourcePositions: [] })
    renderEditor({ reference: { ...DEFAULT_REFERENCE, ...identity } })
    await waitFor(() => expect(mocks.loadRows).toHaveBeenCalledOnce())
    expect(screen.getByLabelText('Дата заявки ЛНК')).toBeDisabled()
    expect(screen.getByLabelText('Название всего документа')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Сохранить изменения документа' })).toBeDisabled()
    expect(screen.getByText(/Нет права изменения в/)).toBeVisible()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.changeDate).not.toHaveBeenCalled()
  })

  it('saves by the document working area without documents.edit or the current page edit permission', async () => {
    mocks.can.mockImplementation((permission: string) => permission === 'lnk.edit')
    mocks.loadRows.mockResolvedValue({ rows: [row(1, { vikRequest: DEFAULT_REFERENCE.title, vikRequestDate: DEFAULT_REFERENCE.date })], sourcePositions: [] })
    mocks.changeDate.mockResolvedValue(null)
    renderEditor()
    const name = screen.getByLabelText('Название всего документа')
    await waitFor(() => expect(name).toBeEnabled())
    fireEvent.change(name, { target: { value: 'Исправленная заявка' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения документа' }))
    await waitFor(() => expect(mocks.changeDate).toHaveBeenCalledOnce())
    expect(mocks.changeDate.mock.calls[0][0].data.nextTitle).toBe('Исправленная заявка')
  })

  it.each([undefined, 'beforeHeatTreatment' as const, 'pstoCycle' as const])('loads a large summary through its compact identity for %s', async sourceKind => {
    const summary = {
      ...DEFAULT_REFERENCE, documentId: 675, sourceKind, cycleSequences: sourceKind === 'pstoCycle' ? [1, 2] : undefined,
      rowIds: Array.from({ length: 10_000 }, (_, index) => index + 1),
      jointComposition: 'Линия · Стык '.repeat(10_000), documentVersion: 'snapshot-version', specialistsRevision: 4,
    }
    mocks.loadRows.mockResolvedValue({ rows: [], sourcePositions: [] })
    renderEditor({ reference: summary })
    await waitFor(() => expect(mocks.loadRows).toHaveBeenCalledOnce())
    expect(JSON.stringify(mocks.loadRows.mock.calls[0][0]).length).toBeLessThan(500)
    expect(mocks.loadRows.mock.calls[0][0]).toEqual({
      type: DEFAULT_REFERENCE.type, title: DEFAULT_REFERENCE.title, date: DEFAULT_REFERENCE.date,
      documentId: sourceKind ? undefined : 675, sourceKind, cycleSequences: summary.cycleSequences,
    })
    expect(summary.rowIds).toHaveLength(10_000)
    expect(summary.documentId).toBe(675)
  })

  it('does not rescan composition on name keystrokes and confirms and saves the final name', async () => {
    const plan = vi.spyOn(documentPlans, 'buildSystemDocumentDateChangePlan')
    const chronology = vi.spyOn(chronologyActions, 'getNewChronologyRootCauseState')
    const rows = [1, 2, 3].map(id => row(id, { vikRequest: DEFAULT_REFERENCE.title, vikRequestDate: DEFAULT_REFERENCE.date }))
    mocks.loadRows.mockResolvedValue({ rows, sourcePositions: [] })
    mocks.changeDate.mockResolvedValue(null)
    renderEditor()
    const title = screen.getByLabelText('Название всего документа')
    const save = screen.getByRole('button', { name: 'Сохранить изменения документа' })
    await waitFor(() => expect(title).toBeEnabled())
    const initialPlanCount = plan.mock.calls.length
    const initialChronologyCount = chronology.mock.calls.length
    for (const name of ['Н', 'Но', 'Новое', 'Новое имя']) fireEvent.change(title, { target: { value: name } })
    expect(save).toBeEnabled()
    fireEvent.change(title, { target: { value: '   ' } })
    expect(save).toBeDisabled()
    expect(screen.getByText(/Укажите наименование документа/)).toBeVisible()
    fireEvent.change(title, { target: { value: 'Итоговое' } })
    expect(plan).toHaveBeenCalledTimes(initialPlanCount)
    expect(chronology).toHaveBeenCalledTimes(initialChronologyCount)
    fireEvent.change(screen.getByLabelText('Дата заявки ЛНК'), { target: { value: '2026-08-10' } })
    expect(plan).toHaveBeenCalledTimes(initialPlanCount + 1)
    expect(chronology).toHaveBeenCalledTimes(initialChronologyCount + 1)
    for (const name of ['Итоговое и', 'Итоговое имя']) fireEvent.change(title, { target: { value: name } })
    expect(plan).toHaveBeenCalledTimes(initialPlanCount + 1)
    expect(chronology).toHaveBeenCalledTimes(initialChronologyCount + 1)
    expect(mocks.loadRows).toHaveBeenCalledOnce()
    fireEvent.click(save)
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining('→ «Итоговое имя».'),
    })))
    await waitFor(() => expect(mocks.changeDate).toHaveBeenCalledWith({ data: expect.objectContaining({
      nextTitle: 'Итоговое имя', nextDate: '2026-08-10', expectedVersions: rows.map(row => ({ id: row.id, version: row.rowVersion })),
    }) }))
  })

  it('saves only the member versions shown before confirmation, even if the context refreshes meanwhile', async () => {
    const original = row(1, { vikRequest: DEFAULT_REFERENCE.title, vikRequestDate: DEFAULT_REFERENCE.date })
    mocks.loadRows.mockResolvedValue({ rows: [original], sourcePositions: [] })
    mocks.changeDate.mockResolvedValue(null)
    let accept!: (value: boolean) => void
    mocks.confirm.mockImplementation(() => new Promise(resolve => { accept = resolve }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><SystemDocumentDateEditor reference={DEFAULT_REFERENCE} label="Дата" /></QueryClientProvider>)
    await waitFor(() => expect(screen.getByLabelText('Дата')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-08-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения документа' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    await act(async () => { client.setQueryData(documentContextKey(DEFAULT_REFERENCE), {
      rows: [{ ...original, rowVersion: 'changed' }, row(2, { vikRequest: DEFAULT_REFERENCE.title, vikRequestDate: DEFAULT_REFERENCE.date })], sourcePositions: [],
    }) })
    await waitFor(() => expect(screen.getByText(/Будет изменено позиций: 2; стыков: 2/)).toBeVisible())
    await act(async () => { accept(true) })
    await waitFor(() => expect(mocks.changeDate).toHaveBeenCalledWith({ data: expect.objectContaining({
      expectedVersions: [{ id: 1, version: 'v1' }], nextDate: '2026-08-10',
    }) }))
  })

  it('allows retrying the same draft after cancelling specialist confirmation', async () => {
    mocks.loadRows.mockResolvedValue({ rows: [row(1, { vikRequest: DEFAULT_REFERENCE.title, vikRequestDate: DEFAULT_REFERENCE.date })], sourcePositions: [] })
    mocks.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    mocks.changeDate.mockRejectedValueOnce(new Error(`Изменение даты заключения [specialist-confirmation:${'a'.repeat(64)}]`)).mockResolvedValue(null)
    const onMessage = vi.fn()
    renderEditor({ onMessage })
    await waitFor(() => expect(screen.getByLabelText('Дата заявки ЛНК')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Дата заявки ЛНК'), { target: { value: '2026-08-10' } })
    const save = screen.getByRole('button', { name: 'Сохранить изменения документа' })
    fireEvent.click(save)
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith('Сохранение отменено. Назначения специалистов не изменены.'))
    expect(screen.getByLabelText('Дата заявки ЛНК')).toHaveValue('2026-08-10')
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)
    await waitFor(() => expect(mocks.changeDate).toHaveBeenCalledTimes(2))
  })

  it('opens only one confirmation for repeated save clicks and keeps the fields locked until it closes', async () => {
    mocks.loadRows.mockResolvedValue({ rows: [row(1, { vikRequest: DEFAULT_REFERENCE.title, vikRequestDate: DEFAULT_REFERENCE.date })], sourcePositions: [] })
    let cancel!: (value: boolean) => void
    mocks.confirm.mockImplementation(() => new Promise(resolve => { cancel = resolve }))
    renderEditor()
    await waitFor(() => expect(screen.getByLabelText('Дата заявки ЛНК')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Дата заявки ЛНК'), { target: { value: '2026-08-10' } })
    const save = screen.getByRole('button', { name: 'Сохранить изменения документа' })
    fireEvent.click(save)
    fireEvent.click(save)
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Дата заявки ЛНК')).toBeDisabled()
    await act(async () => { cancel(false) })
    expect(save).toBeEnabled()
    expect(mocks.changeDate).not.toHaveBeenCalled()
  })

  it('saves date and name together and blocks a conflict on the third member', async () => {
    const reference = { documentId: 675, type: 'lnkConclusion' as const, methodCode: 'ВИК', title: 'Общее', date: '2026-08-10' }
    const rows = [1, 2, 3].map(id => row(id, { hasVik: 'да', vikRequest: 'Заявка',
      vikRequestDate: id === 3 ? '2026-08-09' : '2026-08-02', vikResult: 'годен', vikConclusion: reference.title, vikConclusionDate: reference.date }))
    mocks.loadRows.mockResolvedValue({ rows, sourcePositions: [] })
    mocks.confirm.mockResolvedValue(false)
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SystemDocumentDateEditor reference={reference} label="Дата документа" nameLabel="Название документа" />
    </QueryClientProvider>)
    await waitFor(() => expect(screen.getByLabelText('Название документа')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Название документа'), { target: { value: 'Новое общее' } })
    fireEvent.change(screen.getByLabelText('Дата документа'), { target: { value: '2026-08-08' } })
    expect(screen.getByRole('button', { name: 'Сохранить изменения документа' })).toBeDisabled()
    expect(screen.getByText(/Сохранение заблокировано/)).toHaveTextContent('F3')
    expect(mocks.changeDate).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Название документа'), { target: { value: 'Другое имя при неверной дате' } })
    expect(screen.getByRole('button', { name: 'Сохранить изменения документа' })).toBeDisabled()
    expect(screen.getByText(/Сохранение заблокировано/)).toHaveTextContent('F3')
    fireEvent.change(screen.getByLabelText('Название документа'), { target: { value: 'Новое общее' } })
    fireEvent.change(screen.getByLabelText('Дата документа'), { target: { value: '2026-08-11' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения документа' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining('3 поз. в 3 ст.'),
    })))
    expect(mocks.changeDate).not.toHaveBeenCalled()
    mocks.confirm.mockResolvedValue(true)
    mocks.changeDate.mockResolvedValue({ nextReference: { ...reference, title: 'Новое общее', date: '2026-08-11' }, nextTitle: 'Новое общее', nextDate: '2026-08-11', rows, rowCount: 3, positionCount: 3 })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения документа' }))
    await waitFor(() => expect(mocks.changeDate).toHaveBeenCalledWith({ data: expect.objectContaining({ reference,
      nextTitle: 'Новое общее', nextDate: '2026-08-11', expectedVersions: rows.map(row => ({ id: row.id, version: row.rowVersion })),
    }) }))
  })

  it('refreshes cached source rows when the same document ID changes title or date', async () => {
    const reference = { documentId: 675, type: 'lnkConclusion' as const, methodCode: 'ВИК', title: 'Первое', date: '2026-08-10' }
    mocks.loadRows.mockImplementation(async ref => ({ rows: [row(1, { vikConclusion: ref.title, vikConclusionDate: ref.date })], sourcePositions: [] }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const editor = (ref: typeof reference) => <QueryClientProvider client={client}><SystemDocumentDateEditor reference={ref} label="Дата" nameLabel="Название" /></QueryClientProvider>
    const view = render(editor(reference))
    await waitFor(() => expect(screen.getByLabelText('Название')).toBeEnabled())
    view.rerender(editor({ ...reference, title: 'Второе', date: '2026-08-11' }))
    await waitFor(() => expect(mocks.loadRows).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('Название')).toHaveValue('Второе')
    expect(screen.getByLabelText('Дата')).toHaveValue('2026-08-11')
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Третье' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить изменения документа' })).toBeEnabled())
  })

  it('explains stale composition instead of silently disabling save and allows retry', async () => {
    const reference = { type: 'lnkConclusion' as const, methodCode: 'ВИК', title: 'Общее', date: '2026-08-10' }
    mocks.loadRows.mockResolvedValueOnce({ rows: [row(1, { vikConclusion: 'Уже изменено', vikConclusionDate: reference.date })], sourcePositions: [] })
      .mockResolvedValue({ rows: [row(1, { vikConclusion: reference.title, vikConclusionDate: reference.date })], sourcePositions: [] })
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SystemDocumentDateEditor reference={reference} label="Дата" nameLabel="Название" />
    </QueryClientProvider>)
    await waitFor(() => expect(screen.getByLabelText('Название')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Новое' } })
    expect(await screen.findByText(/Сохранение заблокировано/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Сохранить изменения документа' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку состава' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить изменения документа' })).toBeEnabled())
    expect(mocks.loadRows).toHaveBeenCalledTimes(2)
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
        title: 'Заявка-09.08.2026-007',
        date: '2026-08-10',
      },
      previousTitle: 'Заявка-09.08.2026-007',
      nextTitle: 'Заявка-09.08.2026-007',
      previousDate: '2026-08-09',
      nextDate: '2026-08-10',
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
      'Состав документа и результаты не изменятся.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения документа' }))

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining('все позиции документа: 3 поз. в 2 ст.'),
      warning: expect.stringContaining('Состав документа и результаты сохранятся'),
    })))
    await waitFor(() => expect(mocks.changeDate).toHaveBeenCalledWith({
      data: {
        reference: {
          type: 'lnkRequest',
          title: 'Заявка-09.08.2026-007',
          date: '2026-08-09',
        },
        nextDate: '2026-08-10',
        nextTitle: 'Заявка-09.08.2026-007',
        expectedVersions: [
          { id: 1, version: 'v1' },
          { id: 2, version: 'v2' },
        ],
      },
    }))
    expect(mocks.can).toHaveBeenCalledWith('lnk.edit')
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(mocks.scheduleWeldDataRefresh).toHaveBeenCalledWith(
      expect.any(QueryClient),
      { upsertRows: rows },
      { refetchLnkWorkflow: true },
    )
    expect(onMessage).toHaveBeenCalledWith(expect.stringContaining('3 позиций (2 стыков)'))
    expect(mocks.loadRows).toHaveBeenCalledTimes(1)
  })

  it('blocks the mutation and exposes every exact next action for a new chronology conflict', async () => {
    const current = row(5, { preHeatTreatmentMode: 'allPsto' as const,
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
      vikResult: 'годен',
      vikConclusion: 'Заключение ВИК',
      vikConclusionDate: '2026-08-31',
    })
    mocks.loadRows.mockResolvedValue({ rows: [current], sourcePositions: [] })
    const onRunRootCauseAction = vi.fn()

    renderEditor({
      reference: {
        type: 'lnkConclusion',
        title: 'Заключение ВИК',
        date: '2026-08-31',
        methodCode: 'ВИК',
      },
      onRunRootCauseAction,
    })
    const input = await screen.findByLabelText('Дата заявки ЛНК')
    fireEvent.change(screen.getByLabelText('Название всего документа'), { target: { value: 'Исправленное заключение ВИК' } })
    fireEvent.change(input, { target: { value: '2026-08-09' } })

    expect(await screen.findByText(/Сохранение заблокировано/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить изменения документа' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Исправить дату заключения ВИК' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Исправить дату ПСТО' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Исправить дату заключения ТВМТ' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Исправить дату заключения ВИК' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения документа' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(mocks.scheduleWeldDataRefresh).toHaveBeenLastCalledWith(
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
