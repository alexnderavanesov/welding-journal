import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    const onExtendRequest = vi.fn()

    render(
      <LnkRequestDialog
        nextRequestName="Заявка-001"
        selectedRowsCount={1}
        selectedRows={[row]}
        requestNaming={defaultRequestNamingState}
        requestDate="2026-08-14"
        requestExtensionOptions={[]}
        initialMode="create"
        initialRequestKey=""
        initialSelectedMethods={new Set()}
        requestSearch=""
        lnkRowsCount={1}
        filteredRows={[row]}
        filteredAvailableRows={[row]}
        selectedIds={new Set([row.id])}
        isPending={false}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        onClose={vi.fn()}
        onOpenRequestRegistry={vi.fn()}
        onRequestNamingChange={vi.fn()}
        onRequestDateChange={vi.fn()}
        onRequestSearchChange={vi.fn()}
        onToggleAllRows={vi.fn()}
        onToggleRow={vi.fn()}
        onSubmit={onSubmit}
        onExtendRequest={onExtendRequest}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'ВИК' }))
    expect(screen.getByText('1/8')).toBeInTheDocument()
    expect(screen.getByText(/Добавится позиций: 1/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Создать заявку' }))
    expect(onSubmit).toHaveBeenCalledWith(['vikRequest'])
  })

  it('previews eligible positions and submits them to an existing open request', async () => {
    const row = {
      id: 1,
      joint: 'F1',
      weldDate: '2026-08-10',
      hasVik: 'дополнительный',
    } as WeldRow
    const onExtendRequest = vi.fn()
    const request = {
      key: '["Заявка-001","2026-08-14"]',
      name: 'Заявка-001',
      date: '2026-08-14',
      label: 'Заявка-001 · 14.08.2026',
      rowCount: 3,
      positionCount: 4,
      methodCodes: ['ВИК'],
      searchText: 'f1',
      disabledReason: null,
    }

    render(
      <LnkRequestDialog
        nextRequestName="Заявка-002"
        selectedRowsCount={1}
        selectedRows={[row]}
        requestNaming={defaultRequestNamingState}
        requestDate="2026-08-14"
        requestExtensionOptions={[request]}
        initialMode="extend"
        initialRequestKey={request.key}
        initialSelectedMethods={new Set()}
        requestSearch=""
        lnkRowsCount={1}
        filteredRows={[row]}
        filteredAvailableRows={[row]}
        selectedIds={new Set([row.id])}
        isPending={false}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        onClose={vi.fn()}
        onOpenRequestRegistry={vi.fn()}
        onRequestNamingChange={vi.fn()}
        onRequestDateChange={vi.fn()}
        onRequestSearchChange={vi.fn()}
        onToggleAllRows={vi.fn()}
        onToggleRow={vi.fn()}
        onSubmit={vi.fn()}
        onExtendRequest={onExtendRequest}
      />,
    )

    await waitFor(() => expect(screen.getByDisplayValue(/Заявка-001/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'ВИК' }))

    expect(screen.getByText(/Сейчас:/)).toHaveTextContent('Сейчас: 3 стыков')
    expect(screen.getByText(/Добавится:/)).toHaveTextContent('Добавится: 1 позиций')
    expect(screen.getByText('Войдут все выбранные позиции: 1.')).toBeInTheDocument()
    expect(screen.getByText(/Сейчас:/).closest('[data-request-extension-summary]')).toHaveClass('h-[72px]')

    fireEvent.click(screen.getByRole('button', { name: 'Добавить в заявку' }))
    expect(onExtendRequest).toHaveBeenCalledWith(['vikRequest'], request)
  })

  it('renders large row sets by fixed pages and toggles a row on the next page', () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: index + 1,
      line: '330-TEST-001',
      joint: `F${index + 1}`,
      weldDate: '2026-08-10',
      hasVik: 'да',
    })) as WeldRow[]
    const onToggleRow = vi.fn()

    render(
      <LnkRequestDialog
        nextRequestName="Заявка-001"
        selectedRowsCount={0}
        selectedRows={[]}
        requestNaming={defaultRequestNamingState}
        requestDate="2026-08-14"
        requestExtensionOptions={[]}
        initialMode="create"
        initialRequestKey=""
        initialSelectedMethods={new Set()}
        requestSearch="330"
        lnkRowsCount={rows.length}
        filteredRows={rows}
        filteredAvailableRows={rows}
        selectedIds={new Set()}
        isPending={false}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        onClose={vi.fn()}
        onOpenRequestRegistry={vi.fn()}
        onRequestNamingChange={vi.fn()}
        onRequestDateChange={vi.fn()}
        onRequestSearchChange={vi.fn()}
        onToggleAllRows={vi.fn()}
        onToggleRow={onToggleRow}
        onSubmit={vi.fn()}
        onExtendRequest={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('checkbox')).toHaveLength(50)
    expect(screen.getByText('1 из 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница стыков' }))

    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.getByText('51-51')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggleRow).toHaveBeenCalledWith(51)
  })
})
