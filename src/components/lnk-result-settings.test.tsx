import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LnkResultSettings } from '@/components/lnk-result-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/report-config'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import { createDefaultLnkResultDraft } from '@/lib/report-draft-state'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { buildSystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'

const selectedRows = [{ id: 1, joint: 'F16A' }] as WeldRow[]
const callbacks = {
  onMethodChange: vi.fn(),
  onControlDateChange: vi.fn(),
  onDefaultResultChange: vi.fn(),
  onConclusionNamingChange: vi.fn(),
}

function createCreationPlan(draft: ReturnType<typeof createDefaultLnkResultDraft>) {
  return buildSystemDocumentCreationPlan({
    type: 'lnkConclusion',
    methodCode: 'ВИК',
    date: draft.controlDate,
    rows: selectedRows,
    naming: draft.conclusionNaming,
    settings: REQUEST_CONCLUSION_DEFAULT_SETTINGS,
    nextNumber: 1,
  })
}

describe('LnkResultSettings', () => {
  it('does not show a generic conclusion name before the control method is selected', () => {
    render(
      <LnkResultSettings
        draft={{
          ...createDefaultLnkResultDraft(),
          rowIds: new Set([1]),
          result: 'годен',
        }}
        selectedMethods={[LNK_METHODS[0]]}
        selectedRows={selectedRows}
        nextConclusionName="ЗНК-ЛНК-25.08.2026-001"
        creationPlan={null}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        {...callbacks}
      />,
    )

    expect(screen.getByText('Сначала выберите метод контроля')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('ЗНК-ЛНК-25.08.2026-001')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Системное' })).not.toBeInTheDocument()
    expect(screen.queryByText('Разделение:')).not.toBeInTheDocument()
  })

  it('shows the method-specific name and split preview after selection', () => {
    const draft = {
      ...createDefaultLnkResultDraft(),
      methodKey: 'vikRequest' as const,
      rowIds: new Set([1]),
      result: 'годен',
    }
    render(
      <LnkResultSettings
        draft={draft}
        selectedMethods={[LNK_METHODS[0]]}
        selectedRows={selectedRows}
        nextConclusionName="ЗНК-ВИК-25.08.2026-001"
        creationPlan={createCreationPlan(draft)}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        {...callbacks}
      />,
    )

    expect(screen.getByDisplayValue('ЗНК-ВИК-25.08.2026-001')).toBeInTheDocument()
    expect(screen.getByText('Разделение:')).toBeInTheDocument()
    expect(screen.queryByText('Сначала выберите метод контроля')).not.toBeInTheDocument()
  })
})
