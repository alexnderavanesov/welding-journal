import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PstoRequestManagerDialog } from '@/components/psto-request-manager-dialog'
import { PstoResultManagerDialog } from '@/components/psto-result-manager-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'
import { createRequestDocumentIdentity } from '@/lib/request-document-identity'

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
        requestNameDraft={request.name}
        isManagerPending={false}
        isCorrectionPending={false}
        canOpenDocument
        onClose={vi.fn()}
        onChangeRequest={vi.fn()}
        onRequestNameDraftChange={vi.fn()}
        onRenameRequest={vi.fn()}
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
        diagramDrafts={{ [row.id]: row.heatTreatmentDiagram as string }}
        isPending={false}
        canOpenDocument
        onClose={vi.fn()}
        onDiagramDraftChange={vi.fn()}
        onRenameDiagram={vi.fn()}
        onDeleteResult={vi.fn()}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={onOpenJournalRows}
        onCopyDocumentName={vi.fn()}
      />,
    )

    fireEvent.contextMenu(screen.getByText('Линия-1 · F7'))
    fireEvent.click(screen.getByRole('button', { name: 'В сварочном журнале, новая вкладка' }))

    expect(onOpenJournalRows).toHaveBeenCalledWith([row], 'результат ПСТО · стык F7')
  })

  it('keeps the native context menu in a diagram name input', () => {
    render(
      <PstoResultManagerDialog
        rows={[row]}
        diagramDrafts={{ [row.id]: row.heatTreatmentDiagram as string }}
        isPending={false}
        canOpenDocument
        onClose={vi.fn()}
        onDiagramDraftChange={vi.fn()}
        onRenameDiagram={vi.fn()}
        onDeleteResult={vi.fn()}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onCopyDocumentName={vi.fn()}
      />,
    )

    fireEvent.contextMenu(screen.getByPlaceholderText('Наименование диаграммы для этого стыка'))

    expect(screen.queryByRole('button', { name: 'Открыть диаграмму' })).not.toBeInTheDocument()
  })
})
