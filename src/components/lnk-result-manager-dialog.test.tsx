import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { fireEvent, render as baseRender, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LnkResultManagerDialog } from '@/components/lnk-result-manager-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/lnk-report-config'

const vikMethod = LNK_METHODS.find((method) => method.requestKey === 'vikRequest')!
const rkMethod = LNK_METHODS.find((method) => method.requestKey === 'rkRequest')!
const pvkMethod = LNK_METHODS.find((method) => method.requestKey === 'pvkRequest')!
const access = vi.hoisted(() => ({ canDelete: true }))
vi.mock('@/lib/security-context', () => ({ useAccess: () => ({ can: (permission: string) => permission !== 'lnk.delete' || access.canDelete }) }))
beforeEach(() => { access.canDelete = true })

const vikRow = {
  id: 1,
  projectTitle: 'Проект А',
  subtitleCode: 'Шифр-А',
  line: 'Линия-1',
  joint: 'F1',
  hasVik: 'да',
  vikRequest: 'Заявка-001',
  vikRequestDate: '2026-08-14',
  vikResult: 'годен',
  vikConclusion: 'ВИК-17',
  vikConclusionDate: '2026-08-15',
} as WeldRow

const rkRow = {
  id: 2,
  projectTitle: 'Проект Б',
  subtitleCode: 'Шифр-Б',
  line: 'Линия-2',
  joint: 'F2',
  hasRk: 'да',
  rkRequest: 'Заявка-002',
  rkRequestDate: '2026-08-16',
  rkResult: 'ремонт',
  rkConclusion: 'РК-24',
  rkConclusionDate: '2026-08-17',
} as WeldRow

function renderDialog(overrides: Partial<Parameters<typeof LnkResultManagerDialog>[0]> = {}, edit = true) {
  const onOpenRows = vi.fn()
  const onOpenDocument = vi.fn()
  const onOpenJournalRows = vi.fn()
  const entries = [
    { row: vikRow, method: vikMethod, changeKey: '1:vikRequest' },
    { row: rkRow, method: rkMethod, changeKey: '2:rkRequest' },
  ]
  render(
    <LnkResultManagerDialog
      rows={[vikRow, rkRow]}
      methods={[vikMethod, rkMethod]}
      entries={entries}
      pendingEntries={[]}
      isContextReady
      methodKey=""
      initialEntryKey="1:vikRequest"
      conclusionDrafts={{}}
      pendingResultChanges={{}}
      changeHint={null}
      isResultReplacementPending={false}
      isConclusionCorrectionPending={false}
      onClose={vi.fn()}
      onOpenAddResult={vi.fn()}
      onOpenRows={onOpenRows}
      onOpenDocument={onOpenDocument}
      onOpenJournalRows={onOpenJournalRows}
      onCopyDocumentName={vi.fn()}
      canOpenDocument={() => true}
      onMethodChange={vi.fn()}
      onConclusionDraftChange={vi.fn()}
      onRenameConclusion={vi.fn()}
      onReplaceResult={vi.fn()}
      onClearResult={vi.fn()}
      onResetPendingChanges={vi.fn()}
      onSaveChanges={vi.fn()}
      {...overrides}
    />,
  )
  if (edit) openEditors()
  return { onOpenRows, onOpenDocument, onOpenJournalRows }
}

describe('LnkResultManagerDialog', () => {
  it('hides mutations initially and opens the same two scopes from button or context menu', () => {
    renderDialog({}, false)
    expect(screen.queryByRole('button', { name: 'Удалить результат' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('document-date-editor')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }))
    expect(screen.getByRole('button', { name: 'К документу' })).toBeVisible()
    expect(screen.getByRole('region', { name: /Редактирование результата стыка/ })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть редактирование' }))
    expect(screen.queryByRole('button', { name: 'Удалить результат' })).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByRole('button', { name: /Линия-2/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Внести изменения' }))
    expect(screen.getByRole('region', { name: /Редактирование результата стыка · F2 · РК/ })).toBeVisible()
    expect(screen.getByRole('button', { name: 'К документу' })).toBeVisible()
  })

  it('distinguishes loaded joints from matching results and keeps an empty portion loadable without automatic requests', () => {
    const onLoadMoreRows = vi.fn(), onRegistrySearchChange = vi.fn(), onRegistryResultFilterChange = vi.fn()
    renderDialog({ registryScope: 'all', rows: Array.from({ length: 500 }, (_, index) => ({ ...vikRow, id: index + 1 })),
      entries: [], hasMoreRows: true, onLoadMoreRows, onRegistrySearchChange, onRegistryResultFilterChange })
    expect(screen.getByText('Загружено стыков: 500')).toBeVisible()
    expect(screen.getByText('Результатов в загруженной части: 0')).toBeVisible()
    expect(screen.getByPlaceholderText('Стык, линия, заявка или заключение')).toHaveAttribute('title', 'Поиск и фильтр результата отбирают стыки во всём реестре.')
    expect(screen.getByLabelText('Вид контроля в реестре')).toHaveAttribute('aria-description', 'Вид контроля применяется к загруженной части.')
    expect(screen.getByText(/В загруженной части нет подходящих результатов. Загрузите ещё/)).toBeVisible()
    expect(onLoadMoreRows).not.toHaveBeenCalled()
    expect(onRegistrySearchChange).not.toHaveBeenCalled()
    expect(onRegistryResultFilterChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё результаты' }))
    expect(onLoadMoreRows).toHaveBeenCalledTimes(1)
  })

  it('describes a selected composition without claiming a global registry search', () => {
    renderDialog({ registryScope: 'selected' })
    expect(screen.getByText('Стыков в выборе: 2')).toBeVisible()
    expect(screen.getByText('Результатов по фильтрам: 2')).toBeVisible()
    expect(screen.getByPlaceholderText('Стык, линия, заявка или заключение')).toHaveAttribute('title', 'Поиск и фильтры применяются только к выбранным стыкам.')
    expect(screen.getByLabelText('Вид контроля в реестре')).toHaveAttribute('aria-description', 'Вид контроля применяется только к выбранным стыкам.')
  })

  it('does not offer deletion through the context menu when the user only has edit permission', () => {
    access.canDelete = false
    const onClearResult = vi.fn()
    renderDialog({ onClearResult })
    fireEvent.contextMenu(screen.getByRole('button', { name: /Линия-2/ }))
    expect(within(screen.getByTestId('context-action-menu')).queryByRole('button', { name: 'Удалить результат' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Внести изменения' }))
    const remove = screen.getByRole('button', { name: 'Удалить результат' })
    expect(remove).toBeDisabled()
    fireEvent.click(remove)
    expect(onClearResult).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('Заключение только этого стыка')).toBeEnabled()
  })
  const layeredRow = { ...vikRow, layeredControlAssigned: true, pvkResult: 'годен', pvkConclusion: 'ПВК-1', pvkConclusionDate: '2026-08-15', hasPvk: 'да' } as WeldRow
  const layeredEntry = { row: layeredRow, method: pvkMethod, changeKey: '1:pvkRequest' }

  it('offers a distinct layered removal only for the selected assigned PVK result', () => {
    const onRemoveLayeredControl = vi.fn()
    const onClearResult = vi.fn()
    renderDialog({ rows: [layeredRow, rkRow], entries: [layeredEntry, { row: rkRow, method: rkMethod, changeKey: '2:rkRequest' }], initialEntryKey: layeredEntry.changeKey, onRemoveLayeredControl, onClearResult })
    fireEvent.click(screen.getByRole('button', { name: 'Убрать послойный контроль' }))
    expect(onRemoveLayeredControl).toHaveBeenCalledExactlyOnceWith(layeredRow)
    expect(onClearResult).not.toHaveBeenCalled()
    expect(screen.getByText(/обычный ПВК сохранится/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Линия-2 · F2/ }))
    expect(screen.queryByRole('button', { name: 'Убрать послойный контроль' })).not.toBeInTheDocument()
  })

  it.each([
    { row: { ...layeredRow, layeredControlAssigned: false }, method: pvkMethod },
    { row: layeredRow, method: vikMethod },
  ])('does not offer removal without an assigned PVK card', ({ row, method }) => {
    renderDialog({ rows: [row], entries: [{ row, method, changeKey: 'selected' }], initialEntryKey: 'selected', onRemoveLayeredControl: vi.fn() })
    expect(screen.queryByRole('button', { name: 'Убрать послойный контроль' })).not.toBeInTheDocument()
  })

  it.each([
    { pendingResultChanges: { '2:rkRequest': 'годен' } },
    { conclusionDrafts: { '1:pvkRequest': 'Новое имя' } },
    { isResultReplacementPending: true },
    { isConclusionCorrectionPending: true },
    { isRequestCorrectionPending: true },
  ])('protects unfinished edits and in-flight mutations from immediate layered removal: %j', (overrides) => {
    const onRemoveLayeredControl = vi.fn()
    renderDialog({ rows: [layeredRow], entries: [layeredEntry], initialEntryKey: layeredEntry.changeKey, onRemoveLayeredControl, ...overrides })
    const button = screen.getByRole('button', { name: 'Убрать послойный контроль' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onRemoveLayeredControl).not.toHaveBeenCalled()
  })

  it('blocks competing writes while removing and shows feedback only on the affected PVK card', () => {
    renderDialog({ rows: [layeredRow], entries: [layeredEntry], initialEntryKey: layeredEntry.changeKey, onRemoveLayeredControl: vi.fn(), isLayeredControlRemovalPending: true,
      layeredControlRemovalFeedback: { rowId: 2, tone: 'error', message: 'Ошибка другого стыка' } })
    expect(screen.getByRole('button', { name: 'Удаление…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Удалить результат' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Сохранить изменения' })).toBeDisabled()
    expect(screen.getByPlaceholderText('Заключение только этого стыка')).toBeDisabled()
    expect(screen.queryByText('Ошибка другого стыка')).not.toBeInTheDocument()
  })

  it.each([false, true])('does not keep an outdated removal notice after reassignment: assigned=%s', (assigned) => {
    const row = { ...layeredRow, layeredControlAssigned: assigned }
    renderDialog({ rows: [row], entries: [{ ...layeredEntry, row }], initialEntryKey: layeredEntry.changeKey,
      onRemoveLayeredControl: vi.fn(), layeredControlRemovalFeedback: { rowId: row.id, tone: 'success', message: 'Послойный контроль убран.' } })
    if (assigned) expect(screen.queryByRole('status')).not.toBeInTheDocument()
    else expect(screen.getByRole('status')).toHaveTextContent('Послойный контроль убран.')
  })

  it('opens the exact result card requested by table navigation', () => {
    const actions = renderDialog()

    expect(screen.getByRole('heading', { name: 'Результаты выбранных стыков ЛНК' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveClass('max-w-[1480px]', 'h-[calc(100dvh-1rem)]')
    expect(screen.getByRole('heading', { name: 'Линия-1 · F1' })).toBeInTheDocument()
    expect(screen.getAllByText('ВИК-17').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Показать в ЛНК' }))
    expect(actions.onOpenRows).toHaveBeenCalledWith(vikRow)

    fireEvent.click(screen.getByRole('button', { name: 'Открыть документ' }))
    expect(actions.onOpenDocument).toHaveBeenCalledWith(vikRow, 'vikConclusion')
  })

  it('searches the registry by line and conclusion', async () => {
    renderDialog({ initialEntryKey: '' })

    fireEvent.change(screen.getByPlaceholderText('Стык, линия, заявка или заключение'), {
      target: { value: 'РК-24' },
    })

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Линия-1/ })).not.toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /Линия-2/ }))
    expect(screen.getByRole('heading', { name: 'Линия-2 · F2' })).toBeInTheDocument()
  })

  it('switches result filters without an intermediate empty card', () => {
    renderDialog()

    const resultFilters = screen.getByRole('group', { name: 'Фильтр результатов' })
    fireEvent.click(within(resultFilters).getByRole('button', { name: 'ремонт' }))

    expect(screen.getByRole('heading', { name: 'Линия-2 · F2' })).toBeInTheDocument()
    expect(screen.queryByText('Выберите результат в списке, чтобы открыть его карточку.')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveClass('h-[calc(100dvh-1rem)]')
  })

  it('renders only the visible entries of a large result registry', () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({
      ...vikRow,
      id: index + 1,
      line: 'Линия',
      joint: `F${index + 1}`,
      vikConclusion: `ВИК-${index + 1}`,
    })) as WeldRow[]
    const entries = rows.map((row) => ({
      row,
      method: vikMethod,
      changeKey: `${row.id}:vikRequest`,
    }))

    renderDialog({ rows, entries, initialEntryKey: entries[0].changeKey })

    const registryButtons = screen.getAllByRole('button').filter((button) =>
      /^Линия · F\d+/.test(button.textContent ?? ''),
    )
    expect(registryButtons).toHaveLength(12)
    expect(screen.queryByRole('button', { name: /Линия · F100/ })).not.toBeInTheDocument()
  })

  it('opens the exact result in the welding journal from its context menu', () => {
    const actions = renderDialog()

    fireEvent.contextMenu(screen.getByRole('button', { name: /Линия-1/ }))
    fireEvent.click(screen.getByRole('button', { name: 'В сварочном журнале, новая вкладка' }))

    expect(actions.onOpenJournalRows).toHaveBeenCalledWith(
      [vikRow],
      'результат ВИК · стык F1',
    )
  })

  it('stages a result change for the exact context-menu entry', () => {
    const onReplaceResult = vi.fn()
    renderDialog({ onReplaceResult })

    fireEvent.contextMenu(screen.getByRole('button', { name: /Линия-2/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Внести изменения' }))
    fireEvent.click(within(screen.getByRole('region', { name: /Редактирование результата стыка/ })).getByRole('button', { name: 'вырез' }))

    expect(onReplaceResult).toHaveBeenCalledWith(rkRow, 'rkRequest', 'вырез')
  })

  it('repairs missing request details from the exact completed result card', () => {
    const malformedRow = {
      ...vikRow,
      vikRequest: null,
      vikRequestDate: null,
    } as WeldRow
    const onRepairRequest = vi.fn()

    renderDialog({
      rows: [malformedRow],
      entries: [{ row: malformedRow, method: vikMethod, changeKey: '1:vikRequest' }],
      initialEntryKey: '1:vikRequest',
      rootCauseTarget: {
        kind: 'lnk-control',
        rowId: 1,
        stage: 'primary',
        methodCode: 'ВИК',
        documentPart: 'request',
        focus: 'date',
      },
      onRepairRequest,
    })

    fireEvent.change(screen.getByLabelText('Дата заявки'), {
      target: { value: '2026-08-14' },
    })
    fireEvent.change(screen.getByLabelText('Наименование заявки'), {
      target: { value: 'Заявка-001 восстановлена' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить заявку' }))

    expect(onRepairRequest).toHaveBeenCalledWith(
      malformedRow,
      'vikRequest',
      'Заявка-001 восстановлена',
      '2026-08-14',
    )
  })

})

function openEditors() {
  for (const details of document.querySelectorAll('details')) details.open = true
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
vi.mock('@/lib/system-document-storage', () => ({ loadWorkflowDocumentHistoryGrid: async () => ({ rows: [], total: 0 }) }))
