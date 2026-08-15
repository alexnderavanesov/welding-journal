import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LnkRequestDialog } from '@/components/lnk-request-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'
import { defaultRequestNamingState } from '@/lib/request-naming-state'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

describe('LnkRequestDialog', () => {
  it('keeps method selection local and submits the selected method keys', () => {
    const row = {
      id: 1,
      joint: 'F1',
      weldDate: '2026-08-10',
      hasVik: 'да',
    } as WeldRow
    const onSubmit = vi.fn()

    render(
      <LnkRequestDialog
        nextRequestName="Заявка-001"
        selectedRowsCount={1}
        selectedRows={[row]}
        requestNaming={defaultRequestNamingState}
        requestDate="2026-08-14"
        requestManagerOptions={[]}
        initialSelectedMethods={new Set()}
        requestSearch=""
        lnkRowsCount={1}
        filteredRows={[row]}
        filteredAvailableRows={[row]}
        selectedIds={new Set([row.id])}
        isPending={false}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        onClose={vi.fn()}
        onOpenRequestManager={vi.fn()}
        onRequestNamingChange={vi.fn()}
        onRequestDateChange={vi.fn()}
        onRequestSearchChange={vi.fn()}
        onToggleAllRows={vi.fn()}
        onToggleRow={vi.fn()}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'ВИК' }))
    expect(screen.getByText('1/8')).toBeInTheDocument()
    expect(screen.getByText(/Позиций: 1/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Создать заявку' }))
    expect(onSubmit).toHaveBeenCalledWith(['vikRequest'])
  })
})
