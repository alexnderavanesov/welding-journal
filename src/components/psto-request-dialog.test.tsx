import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PstoRequestDialog } from '@/components/psto-request-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'
import { defaultRequestNamingState } from '@/lib/request-naming-state'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

describe('PstoRequestDialog', () => {
  it('keeps the joint list and request names in separate full-width tabs', () => {
    const row = {
      id: 1,
      projectTitle: 'Проект А',
      subtitleCode: '500',
      line: 'L-10',
      joint: 'F5',
      weldDate: '2026-08-10',
      pstoRequired: 'да',
    } as WeldRow
    const onRequestNamingChange = vi.fn()

    function StatefulPstoRequestDialog() {
      const [requestNaming, setRequestNaming] = useState(defaultRequestNamingState)
      return (
        <PstoRequestDialog
        nextRequestName="ПСТО-001"
        selectedRows={[row]}
        requestNaming={requestNaming}
        requestDate="2026-08-14"
        requestSearch=""
        requestManagerOptions={[]}
        heatTreatmentRowsCount={1}
        filteredRows={[row]}
        requestRows={[row]}
        availableRowsCount={1}
        selectedIds={new Set([row.id])}
        areAllAvailableRowsSelected
        isPending={false}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        canCreateRequest={() => true}
        onClose={vi.fn()}
        onOpenRequestManager={vi.fn()}
        onRequestNamingChange={(value) => {
          onRequestNamingChange(value)
          setRequestNaming(value)
        }}
        onRequestDateChange={vi.fn()}
        onRequestSearchChange={vi.fn()}
        onClearSelection={vi.fn()}
        onSetSelectedRows={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onToggleAllRows={vi.fn()}
        onToggleRow={vi.fn()}
        onSubmit={vi.fn()}
        />
      )
    }

    render(<StatefulPstoRequestDialog />)

    expect(screen.getByRole('tab', { name: 'Стыки' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Заявки и имена/ })).toHaveTextContent('1')
    expect(screen.getByPlaceholderText('Проект, шифр, линия, спул или стык')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Заявки и имена/ }))

    expect(screen.queryByPlaceholderText('Проект, шифр, линия, спул или стык')).not.toBeInTheDocument()
    expect(screen.getByText('Наименование заявки')).toBeInTheDocument()
    expect(screen.getAllByText(/ПСТО-14\.08\.26-001/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Пользовательское' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Название заявки/ }), {
      target: { value: 'Заявка подрядчика' },
    })
    fireEvent.blur(screen.getByRole('textbox', { name: /Название заявки/ }))

    expect(onRequestNamingChange).toHaveBeenLastCalledWith({
      ...defaultRequestNamingState,
      mode: 'custom',
      customName: 'Заявка подрядчика',
    })
  })
})
