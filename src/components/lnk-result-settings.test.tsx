import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LnkResultSettings } from '@/components/lnk-result-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/report-config'
import { createDefaultLnkResultDraft } from '@/lib/report-draft-state'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

const selectedRows = [{ id: 1, joint: 'F16A' }] as WeldRow[]

describe('LnkResultSettings', () => {
  beforeEach(() => window.localStorage.clear())

  it('collects all selected-row restrictions and releases repair when only an eligible joint remains', () => {
    const rows = [{ id: 1, joint: 'F1', d1: 57 }, { id: 2, joint: 'F2R2', d1: 89 }, { id: 3, joint: 'F3', d1: 89 }] as WeldRow[]
    const props = {
      draft: { ...createDefaultLnkResultDraft(), methodKey: 'rkRequest' as const, rowIds: new Set([1, 2, 3]), result: '' },
      selectedMethods: [...LNK_METHODS], selectedRows: rows, requestKey: '', requestOptions: [],
      saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS, onMethodChange: vi.fn(), onControlDateChange: vi.fn(),
      onDefaultResultChange: vi.fn(), onRequestChange: vi.fn(),
    }
    const { rerender } = render(<LnkResultSettings {...props} />)
    expect(screen.getByRole('button', { name: 'ремонт' })).toBeDisabled()
    fireEvent.focus(screen.getByRole('group', { name: 'ремонт' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('меньше 89 мм')
    expect(screen.getByRole('tooltip')).toHaveTextContent('два ремонта')
    fireEvent.click(screen.getByRole('button', { name: 'ремонт' }))
    expect(props.onDefaultResultChange).not.toHaveBeenCalled()
    rerender(<LnkResultSettings {...props} selectedRows={[rows[2]!]} />)
    expect(screen.getByRole('button', { name: 'ремонт' })).toBeEnabled()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(props.onDefaultResultChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'ремонт' }))
    expect(props.onDefaultResultChange).toHaveBeenCalledExactlyOnceWith('ремонт')
  })

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
        requestKey=""
        requestOptions={[]}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        onMethodChange={vi.fn()}
        onControlDateChange={vi.fn()}
        onDefaultResultChange={vi.fn()}
        onRequestChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Метод контроля')).toBeInTheDocument()
    expect(screen.getByText('Дата контроля')).toBeInTheDocument()
    expect(screen.getByText('Результат для всех выбранных')).toBeInTheDocument()
    expect(screen.getByText('Заявка ЛНК')).toBeInTheDocument()
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
        requestKey=""
        requestOptions={[]}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        onMethodChange={onMethodChange}
        onControlDateChange={vi.fn()}
        onDefaultResultChange={vi.fn()}
        onRequestChange={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: /Метод контроля/ }), {
      target: { value: LNK_METHODS[0].requestKey },
    })

    expect(onMethodChange).toHaveBeenCalledWith(LNK_METHODS[0].requestKey)
  })
})
