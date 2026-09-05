import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PstoRequestManagerDialog } from '@/components/psto-request-manager-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { SystemDocumentReference } from '@/lib/system-document-types'
import { createRequestDocumentIdentity } from '@/lib/request-document-identity'

vi.mock('@/components/system-document-date-editor', () => ({
  SystemDocumentDateEditor: ({ reference }: { reference: SystemDocumentReference }) => (
    <div
      data-testid="system-document-date-editor"
      data-title={reference.title}
      data-date={reference.date}
      data-sequences={reference.cycleSequences?.join(',') ?? ''}
    />
  ),
}))

describe('PstoRequestManagerDialog', () => {
  it('edits the primary request document when the joint already has a repeat cycle', () => {
    const row = {
      id: 7,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F7',
      pstoRequest: 'Основная заявка ПСТО',
      pstoRequestDate: '2026-08-02',
      pstoResult: 'проведено',
      pstoDate: '2026-08-03',
      tvmtRequest: 'Основная заявка ТВМТ',
      tvmtRequestDate: '2026-08-04',
      tvmtResult: 'не годен',
      tvmtConclusion: 'Основное заключение ТВМТ',
      tvmtConclusionDate: '2026-08-05',
      pstoRepeatCycles: [{
        id: 72,
        weldJointId: 7,
        sequence: 2,
        pstoRequest: 'Повторная заявка ПСТО',
        pstoRequestDate: '2026-08-06',
      }],
    } as WeldRow
    const request = createRequestDocumentIdentity(row.pstoRequest, row.pstoRequestDate)!

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
        rootCauseTarget={{
          kind: 'psto-cycle',
          rowId: row.id,
          sequence: 1,
          stage: 'pstoRequest',
          focus: 'date',
        }}
        onClose={vi.fn()}
        onChangeRequest={vi.fn()}
        onRequestNameDraftChange={vi.fn()}
        onRenameRequest={vi.fn()}
        onOpenDocument={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onCopyDocumentName={vi.fn()}
        onClearPosition={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    )

    const editor = screen.getByTestId('system-document-date-editor')
    expect(editor).toHaveAttribute('data-title', 'Основная заявка ПСТО')
    expect(editor).toHaveAttribute('data-date', '2026-08-02')
    expect(editor).toHaveAttribute('data-sequences', '1')
  })
})
