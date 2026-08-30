import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PstoResultDialog } from '@/components/psto-result-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'
import { createDefaultPstoResultDraft } from '@/lib/report-draft-state'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

describe('PstoResultDialog', () => {
  it('disables bulk selection when visible request rows are not selectable', () => {
    const row = {
      id: 1,
      projectTitle: 'Проект А',
      subtitleCode: '500',
      line: 'L-10',
      joint: 'F5',
      pstoRequired: 'да',
    } as WeldRow

    render(
      <PstoResultDialog
        draft={createDefaultPstoResultDraft()}
        requestSearch=""
        nextDiagramName=""
        systemDocumentCreationPlan={{
          type: 'pstoConclusion',
          mode: 'none',
          groups: [],
          missingSummary: '',
          error: '',
        }}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        filteredRows={[row]}
        selectedRows={[]}
        requestRows={[row]}
        filteredRequestOptions={[]}
        availableRequestOptions={[]}
        saveBlockReason="Выберите заявку ПСТО."
        allFilteredSelectableRowsSelected={false}
        canSelectRow={() => false}
        onDraftChange={vi.fn()}
        onRequestSearchChange={vi.fn()}
        onRequestChange={vi.fn()}
        onClearFilters={vi.fn()}
        onClearSelection={vi.fn()}
        onSetSelectedRows={vi.fn()}
        onToggleAll={vi.fn()}
        onToggleRow={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onOpenManager={vi.fn()}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Выбрать все доступные' })).toBeDisabled()
  })
})
