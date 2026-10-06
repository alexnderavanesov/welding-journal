import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LnkResultManagerDialog } from '@/components/lnk-result-manager-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/lnk-report-config'

const vikMethod = LNK_METHODS.find((method) => method.requestKey === 'vikRequest')!
const rkMethod = LNK_METHODS.find((method) => method.requestKey === 'rkRequest')!
const pvkMethod = LNK_METHODS.find((method) => method.requestKey === 'pvkRequest')!

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

function renderDialog(overrides: Partial<Parameters<typeof LnkResultManagerDialog>[0]> = {}) {
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
      isResultCorrectionPending={false}
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
  return { onOpenRows, onOpenDocument, onOpenJournalRows }
}

describe('LnkResultManagerDialog', () => {
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
    { isResultCorrectionPending: true },
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
    expect(screen.getByPlaceholderText('Наименование заключения для этого стыка')).toBeDisabled()
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

    expect(screen.getByRole('heading', { name: 'Редактирование результатов ЛНК' })).toBeInTheDocument()
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
    expect(screen.queryByText('Выберите результат слева, чтобы открыть его карточку.')).not.toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: 'Изменить результат' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('button', { name: 'вырез' }))

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
