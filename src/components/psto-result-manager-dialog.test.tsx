import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PstoResultManagerDialog } from '@/components/psto-result-manager-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('PstoResultManagerDialog', () => {
  it('does not present a missing TVMT result as good and allows restoring it explicitly', () => {
    const onCorrectStage = vi.fn()
    const row = {
      id: 7,
      projectTitle: 'Проект А',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F7',
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      pstoRequest: 'ПСТО-1',
      pstoRequestDate: '2026-08-02',
      pstoResult: 'проведено',
      pstoDate: '2026-08-03',
      heatTreatmentDiagram: 'Диаграмма-1',
      tvmtRequest: 'ТВМТ-1',
      tvmtRequestDate: '2026-08-04',
      tvmtResult: null,
      tvmtConclusionDate: '2026-08-05',
      tvmtConclusion: 'Заключение-ТВМТ-1',
    } as WeldRow

    render(
      <PstoResultManagerDialog
        rows={[row]}
        diagramDrafts={{}}
        isPending={false}
        canOpenDocument={false}
        onClose={vi.fn()}
        onDiagramDraftChange={vi.fn()}
        onRenameDiagram={vi.fn()}
        onDeleteResult={vi.fn()}
        onCorrectStage={onCorrectStage}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onCopyDocumentName={vi.fn()}
      />,
    )

    expect(screen.getByText('Результат: -')).toBeInTheDocument()
    const resultSelect = screen.getByLabelText('Результат')
    const resultArticle = resultSelect.closest('article')
    expect(resultArticle).not.toBeNull()
    const saveButton = within(resultArticle!).getByRole('button', { name: 'Сохранить' })
    expect(resultSelect).toHaveValue('')
    expect(saveButton).toBeDisabled()

    fireEvent.change(resultSelect, { target: { value: 'не годен' } })
    fireEvent.click(saveButton)

    expect(onCorrectStage).toHaveBeenCalledWith({
      rowId: 7,
      sequence: 1,
      cycleId: undefined,
      stage: 'tvmtResult',
      action: 'update',
      date: '2026-08-05',
      name: 'Заключение-ТВМТ-1',
      result: 'не годен',
    })
  })

  it('blocks changing the latest good TVMT to failed after post-heat-treatment LNK exists', () => {
    const onCorrectStage = vi.fn()
    const row = {
      id: 8,
      projectTitle: 'Проект А',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F8',
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      hasVik: 'да',
      pstoRequest: 'ПСТО-1',
      pstoRequestDate: '2026-08-02',
      pstoResult: 'проведено',
      pstoDate: '2026-08-03',
      heatTreatmentDiagram: 'Диаграмма-1',
      tvmtRequest: 'ТВМТ-1',
      tvmtRequestDate: '2026-08-04',
      tvmtResult: 'не годен',
      tvmtConclusionDate: '2026-08-05',
      tvmtConclusion: 'Заключение-ТВМТ-1',
      pstoRepeatCycles: [{
        id: 22,
        weldJointId: 8,
        sequence: 2,
        pstoRequest: 'ПСТО-2',
        pstoRequestDate: '2026-08-06',
        pstoResult: 'проведено',
        pstoDate: '2026-08-07',
        heatTreatmentDiagram: 'Диаграмма-2',
        tvmtRequest: 'ТВМТ-2',
        tvmtRequestDate: '2026-08-08',
        tvmtResult: 'годен',
        tvmtConclusionDate: '2026-08-09',
        tvmtConclusion: 'Заключение-ТВМТ-2',
      }],
      vikRequest: 'Заявка ВИК',
      vikRequestDate: '2026-08-10',
      vikResult: 'годен',
      vikConclusionDate: '2026-08-10',
      vikConclusion: 'Заключение ВИК',
    } as WeldRow

    render(
      <PstoResultManagerDialog
        rows={[row]}
        diagramDrafts={{}}
        isPending={false}
        canOpenDocument={false}
        onClose={vi.fn()}
        onDiagramDraftChange={vi.fn()}
        onRenameDiagram={vi.fn()}
        onDeleteResult={vi.fn()}
        onCorrectStage={onCorrectStage}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onCopyDocumentName={vi.fn()}
      />,
    )

    const resultSelect = screen.getByLabelText('Результат')
    const resultArticle = resultSelect.closest('article')
    expect(resultArticle).not.toBeNull()
    const saveButton = within(resultArticle!).getByRole('button', { name: 'Сохранить' })

    fireEvent.change(resultSelect, { target: { value: 'не годен' } })

    expect(saveButton).toBeDisabled()
    expect(within(resultArticle!).getByText(/Сохранение заблокировано:.*ВИК после ТО/)).toBeInTheDocument()
    fireEvent.click(saveButton)
    expect(onCorrectStage).not.toHaveBeenCalled()
  })
})
