import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render as baseRender, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PstoRequestManagerDialog } from '@/components/psto-request-manager-dialog'
import { PstoResultManagerDialog } from '@/components/psto-result-manager-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'
import { createRequestDocumentIdentity } from '@/lib/request-document-identity'

vi.mock('@/lib/use-document-position-change', () => ({ useDocumentPositionChange: () => vi.fn() }))
vi.mock('@/components/system-document-date-editor', () => ({ SystemDocumentDateEditor: ({ label }: { label: string }) => <input aria-label={label} /> }))

const row = {
  id: 7,
  projectTitle: 'Проект А',
  subtitleCode: 'Шифр-А',
  line: 'Линия-1',
  joint: 'F7',
  pstoRequest: 'Заявка ПСТО-007',
  pstoRequestDate: '2026-08-20',
  pstoResult: 'проведено',
  pstoDate: '2026-08-21',
  heatTreatmentDiagram: 'Диаграмма-007',
} as WeldRow

describe('PSTO manager context menus', () => {
  it('opens the current request document from the request manager menu', () => {
    const request = createRequestDocumentIdentity(row.pstoRequest, row.pstoRequestDate)!
    const onOpenDocument = vi.fn()
    render(
      <PstoRequestManagerDialog
        requestName={request.name}
        requestDate={request.date}
        requestOptions={[request]}
        requestRows={[row]}
        isManagerPending={false}
        isCorrectionPending={false}
        canOpenDocument
        onClose={vi.fn()}
        onChangeRequest={vi.fn()}
        onOpenDocument={onOpenDocument}
        onOpenJournalRows={vi.fn()}
        onCopyDocumentName={vi.fn()}
        onClearPosition={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    )

    fireEvent.contextMenu(screen.getByText('Используется:'))
    fireEvent.click(screen.getByRole('button', { name: 'Открыть заявку' }))

    expect(onOpenDocument).toHaveBeenCalledWith(row)
  })

  it('opens the exact result row in the welding journal from the result manager menu', () => {
    const onOpenJournalRows = vi.fn()
    render(
      <PstoResultManagerDialog
        rows={[row]}
        isPending={false}
        canOpenDocument
        onClose={vi.fn()}
        onRenameDiagram={vi.fn()}
        onDeleteResult={vi.fn()}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={onOpenJournalRows}
        onCopyDocumentName={vi.fn()}
      />,
    )

    const resultCard = screen.getByRole('heading', { name: 'Результат ПСТО' }).closest('article')
    expect(resultCard).not.toBeNull()
    fireEvent.contextMenu(resultCard!)
    fireEvent.click(screen.getByRole('button', { name: 'В сварочном журнале, новая вкладка' }))

    expect(onOpenJournalRows).toHaveBeenCalledWith([row], 'цикл ПСТО/ТВМТ · стык F7')
  })

  it('keeps the native context menu in a diagram name input', () => {
    render(
      <PstoResultManagerDialog
        rows={[row]}
        isPending={false}
        canOpenDocument
        onClose={vi.fn()}
        onRenameDiagram={vi.fn()}
        onDeleteResult={vi.fn()}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onCopyDocumentName={vi.fn()}
      />,
    )

    const card = within(screen.getByRole('heading', { name: 'Результат ПСТО' }).closest('article')!)
    fireEvent.click(card.getByRole('button', { name: 'Редактировать' }))
    fireEvent.contextMenu(card.getByLabelText('Наименование диаграммы только этого стыка'))

    expect(screen.queryByRole('button', { name: 'Открыть диаграмму' })).not.toBeInTheDocument()
  })

  it('does not show the waiting marker as a completed PSTO result stage', () => {
    render(
      <PstoResultManagerDialog
        rows={[{
          ...row,
          pstoResult: 'ожидает',
          pstoDate: null,
          heatTreatmentDiagram: null,
          tvmtRequest: null,
          tvmtRequestDate: null,
          tvmtResult: null,
          tvmtConclusionDate: null,
          tvmtConclusion: null,
        } as WeldRow]}
        isPending={false}
        canOpenDocument
        onClose={vi.fn()}
        onRenameDiagram={vi.fn()}
        onDeleteResult={vi.fn()}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onCopyDocumentName={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Заявка ПСТО' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Результат ПСТО' })).not.toBeInTheDocument()
  })
})

const render = (ui: import('react').ReactNode, options?: import('@testing-library/react').RenderOptions) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return baseRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>, ...options })
}
vi.mock('@/lib/use-system-document-context', () => ({
  useSystemDocumentContext: () => ({ data: { rows: [{ id: 1 }, { id: 2 }], sourcePositions: [] }, isPending: false, isError: false }),
}))
vi.mock('@/lib/system-document-storage', () => ({ loadWorkflowDocumentHistoryGrid: async () => ({ rows: [], total: 0 }) }))
