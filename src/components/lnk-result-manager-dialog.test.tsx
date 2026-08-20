import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LnkResultManagerDialog } from '@/components/lnk-result-manager-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/lnk-report-config'

const vikMethod = LNK_METHODS.find((method) => method.requestKey === 'vikRequest')!
const rkMethod = LNK_METHODS.find((method) => method.requestKey === 'rkRequest')!

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
  return { onOpenRows, onOpenDocument }
}

describe('LnkResultManagerDialog', () => {
  it('opens the exact result card requested by table navigation', () => {
    const actions = renderDialog()

    expect(screen.getByRole('heading', { name: 'Линия-1 · F1' })).toBeInTheDocument()
    expect(screen.getAllByText('ВИК-17').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Показать в ЛНК' }))
    expect(actions.onOpenRows).toHaveBeenCalledWith(vikRow)

    fireEvent.click(screen.getByRole('button', { name: 'Открыть документ' }))
    expect(actions.onOpenDocument).toHaveBeenCalledWith(vikRow, 'vikConclusion')
  })

  it('searches the registry by line and conclusion', () => {
    renderDialog({ initialEntryKey: '' })

    fireEvent.change(screen.getByPlaceholderText('Стык, линия, заявка или заключение'), {
      target: { value: 'РК-24' },
    })

    expect(screen.queryByRole('button', { name: /Линия-1/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Линия-2/ }))
    expect(screen.getByRole('heading', { name: 'Линия-2 · F2' })).toBeInTheDocument()
  })

  it('switches result filters without an intermediate empty card', () => {
    renderDialog()

    const resultFilters = screen.getByRole('group', { name: 'Фильтр результатов' })
    fireEvent.click(within(resultFilters).getByRole('button', { name: 'ремонт' }))

    expect(screen.getByRole('heading', { name: 'Линия-2 · F2' })).toBeInTheDocument()
    expect(screen.queryByText('Выберите результат слева, чтобы открыть его карточку.')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveClass('h-[92vh]')
  })
})
