import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LnkResultDialog, type LnkResultDialogProps } from '@/components/lnk-result-dialog'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/report-config'
import { createDefaultLnkResultDraft } from '@/lib/report-draft-state'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

describe('LnkResultDialog', () => {
  it('offers layered control inside each U-joint, never in the footer or a C-joint', () => {
    const props = createDialogProps()
    const { rerender } = render(<LnkResultDialog {...props} />)
    const footer = screen.getByRole('group', { name: 'Сохранение результата' })
    expect(within(footer).queryByRole('checkbox')).not.toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox', { name: 'Послойный контроль: L-1 · F1' })
    expect(checkbox).not.toBeChecked()
    expect(checkbox).toHaveAccessibleDescription('Назначить ВИК и ПВК кромок и слоёв при сохранении')
    const assigned = screen.getByRole('checkbox', { name: 'Послойный контроль: L-1 · F2' })
    expect(assigned).toBeChecked()
    expect(assigned).toBeDisabled()
    expect(screen.queryByRole('checkbox', { name: 'Послойный контроль: L-1 · F3' })).not.toBeInTheDocument()
    fireEvent.click(checkbox)
    expect(props.onSetLayeredControl).toHaveBeenCalledWith(1, true)
    expect(props.onToggleRow).not.toHaveBeenCalled()
    fireEvent.click(within(footer).getByRole('button', { name: 'Сохранить результат' }))
    expect(props.onSave).toHaveBeenCalledOnce()

    for (const methodKey of ['vikRequest', 'rkRequest', 'uzkRequest', 'tvmtRequest', ''] as const) {
      rerender(<LnkResultDialog {...props} draft={{ ...props.draft, methodKey }} />)
      expect(screen.queryByRole('checkbox', { name: /^Послойный контроль:/ })).not.toBeInTheDocument()
    }
  })

  it('does not bypass ZV and keeps per-row choices in the draft across correction/remount', () => {
    const props = createDialogProps()
    props.draft.layeredControlRowIds = new Set([1])
    const { unmount } = render(<LnkResultDialog {...props} saveBlockReason="ЗВ-15 · Дата контроля раньше сварки." isSaveDisabled />)
    expect(screen.getByRole('checkbox', { name: 'Послойный контроль: L-1 · F1' })).toBeChecked()
    expect(screen.getByText(/Сохранение заблокировано: ЗВ-15/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Сохранить результат' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить результат' }))
    expect(props.onSave).not.toHaveBeenCalled()
    unmount()
    render(<LnkResultDialog {...props} />)
    expect(screen.getByRole('checkbox', { name: 'Послойный контроль: L-1 · F1' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить результат' }))
    expect(props.onSave).toHaveBeenCalledOnce()
  })

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
        onSetLayeredControl={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: action.label }))

    expect(onRunRootCauseAction).toHaveBeenCalledWith(action)
  })
})

function createDialogProps(): LnkResultDialogProps {
  const rows = [1, 2, 3].map((id) => ({ id, line: 'L-1', joint: `F${id}`, connectionType: id === 3 ? 'С17' : 'У19',
    layeredControlAssigned: id === 2, hasPvk: 'да', vikResult: 'годен', pvkRequest: 'ПВК-1', pvkRequestDate: '2026-08-15',
  })) as WeldRow[]
  return {
    draft: { ...createDefaultLnkResultDraft(), methodKey: 'pvkRequest', rowIds: new Set([1, 2, 3]) },
    selectedMethods: [...LNK_METHODS], selectedRows: rows, visibleRows: rows, requestRows: rows,
    availableRequestOptions: [], systemDocumentCreationPlan: null,
    saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS, controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS,
    saveBlockReason: null, isSaveDisabled: false, contextReady: true,
    canBulkToggleRows: true, areAllFilteredRowsSelected: false,
    onClose: vi.fn(), onOpenManager: vi.fn(), onMethodChange: vi.fn(), onControlDateChange: vi.fn(),
    onDefaultResultChange: vi.fn(), onConclusionNamingChange: vi.fn(), onClearSelection: vi.fn(),
    onSetSelectedRows: vi.fn(), onToggleAllRows: vi.fn(), onSearchChange: vi.fn(), onRequestChange: vi.fn(),
    onToggleRow: vi.fn(), onSetRowResult: vi.fn(), onSetLayeredControl: vi.fn(), onSetRowsResult: vi.fn(), onOpenJournalRows: vi.fn(), onSave: vi.fn(),
  }
}
