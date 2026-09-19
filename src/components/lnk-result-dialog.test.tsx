import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LnkResultDialog } from '@/components/lnk-result-dialog'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/report-config'
import { createDefaultLnkResultDraft } from '@/lib/report-draft-state'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

describe('LnkResultDialog', () => {
  it('opens another method correction even when its date matches the current draft', () => {
    const row = {
      id: 1,
      projectTitle: 'Проект А',
      subtitleCode: '500',
      line: 'L-10',
      joint: 'F5',
      vikRequest: 'Заявка-001',
      vikRequestDate: '2026-08-10',
      rkRequest: 'Заявка-001',
      rkRequestDate: '2026-08-10',
    } as WeldRow
    const onRunRootCauseAction = vi.fn()
    const action = {
      key: 'fix-vik-date',
      label: 'Исправить дату заключения ВИК',
      target: {
        kind: 'lnk-control' as const,
        rowId: row.id,
        stage: 'primary' as const,
        methodCode: 'ВИК',
        documentPart: 'conclusion' as const,
        focus: 'date' as const,
        documentDate: '2026-08-15',
      },
    }

    render(
      <LnkResultDialog
        draft={{
          ...createDefaultLnkResultDraft(),
          requestName: 'Заявка-001',
          requestDate: '2026-08-10',
          methodKey: 'rkRequest',
          rowIds: new Set([row.id]),
          controlDate: '2026-08-15',
        }}
        selectedMethods={[...LNK_METHODS]}
        selectedRows={[row]}
        visibleRows={[row]}
        requestRows={[row]}
        availableRequestOptions={[]}
        systemDocumentCreationPlan={null}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        controlProcessSettings={DEFAULT_CONTROL_PROCESS_SETTINGS}
        saveBlockReason="Нарушена хронология."
        rootCauseActions={[action]}
        onRunRootCauseAction={onRunRootCauseAction}
        isSaveDisabled
        contextReady
        canBulkToggleRows
        areAllFilteredRowsSelected={false}
        onClose={vi.fn()}
        onOpenManager={vi.fn()}
        onMethodChange={vi.fn()}
        onControlDateChange={vi.fn()}
        onDefaultResultChange={vi.fn()}
        onConclusionNamingChange={vi.fn()}
        onClearSelection={vi.fn()}
        onSetSelectedRows={vi.fn()}
        onToggleAllRows={vi.fn()}
        onSearchChange={vi.fn()}
        onRequestChange={vi.fn()}
        onToggleRow={vi.fn()}
        onSetRowResult={vi.fn()}
        onSetRowsResult={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: action.label }))

    expect(onRunRootCauseAction).toHaveBeenCalledWith(action)
  })
})
