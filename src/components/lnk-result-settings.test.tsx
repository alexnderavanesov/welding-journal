import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LnkResultSettings } from '@/components/lnk-result-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/report-config'
import { createDefaultLnkResultDraft } from '@/lib/report-draft-state'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

const selectedRows = [{ id: 1, joint: 'F16A' }] as WeldRow[]

describe('LnkResultSettings', () => {
  it('keeps only the compact method, date and common-result controls', () => {
    render(
      <LnkResultSettings
        draft={{
          ...createDefaultLnkResultDraft(),
          rowIds: new Set([1]),
          result: 'годен',
        }}
        selectedMethods={[LNK_METHODS[0]]}
        selectedRows={selectedRows}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        onMethodChange={vi.fn()}
        onControlDateChange={vi.fn()}
        onDefaultResultChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Метод контроля')).toBeInTheDocument()
    expect(screen.getByText('Дата контроля')).toBeInTheDocument()
    expect(screen.getByText('Результат для всех выбранных')).toBeInTheDocument()
    expect(screen.queryByText('Заключение')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Системное' })).not.toBeInTheDocument()
  })

  it('passes a selected method to the existing result workflow', () => {
    const onMethodChange = vi.fn()
    render(
      <LnkResultSettings
        draft={createDefaultLnkResultDraft()}
        selectedMethods={[LNK_METHODS[0]]}
        selectedRows={[]}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        onMethodChange={onMethodChange}
        onControlDateChange={vi.fn()}
        onDefaultResultChange={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: /Метод контроля/ }), {
      target: { value: LNK_METHODS[0].requestKey },
    })

    expect(onMethodChange).toHaveBeenCalledWith(LNK_METHODS[0].requestKey)
  })
})
