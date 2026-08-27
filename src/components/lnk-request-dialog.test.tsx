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
        availableRows={[row]}
        selectedIds={new Set([row.id])}
        isPending={false}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        onClose={vi.fn()}
        onOpenRequestRegistry={vi.fn()}
        onRequestNamingChange={vi.fn()}
        onRequestDateChange={vi.fn()}
        onRequestSearchChange={vi.fn()}
        onClearSelection={vi.fn()}
        onSetSelectedRows={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onToggleAllRows={vi.fn()}
        onToggleRow={vi.fn()}
        onSubmit={onSubmit}
        onExtendRequest={onExtendRequest}
      />,
    )

    expect(screen.getByText('0/8')).toHaveClass('w-10', 'tabular-nums')
    expect(screen.getByDisplayValue('2026-08-14').closest('[data-lnk-request-methods]')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Стыки' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Заявки и имена/ })).toHaveTextContent('0')

    fireEvent.click(screen.getByRole('button', { name: 'ВИК' }))
    expect(screen.getByText('1/8')).toHaveClass('w-10', 'tabular-nums')
    expect(screen.getByText(/Добавится позиций: 1/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Заявки и имена/ })).toHaveTextContent('1')

    fireEvent.click(screen.getByRole('tab', { name: /Заявки и имена/ }))
    expect(screen.getByText('Наименование заявки')).toBeInTheDocument()
    expect(screen.getAllByText(/Заявка-14\.08\.2026-001/).length).toBeGreaterThan(0)
    expect(screen.getByRole('tab', { name: /Заявки и имена/ })).toHaveAttribute('aria-selected', 'true')

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
        availableRows={[row]}
        selectedIds={new Set([row.id])}
        isPending={false}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        onClose={vi.fn()}
        onOpenRequestRegistry={vi.fn()}
        onRequestNamingChange={vi.fn()}
        onRequestDateChange={vi.fn()}
        onRequestSearchChange={vi.fn()}
        onClearSelection={vi.fn()}
        onSetSelectedRows={vi.fn()}
        onOpenJournalRows={vi.fn()}
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
    expect(screen.getByText(/Сейчас:/).closest('[data-request-extension-summary]')).toHaveClass('h-10')

    fireEvent.click(screen.getByRole('button', { name: 'Добавить в заявку' }))
    expect(onExtendRequest).toHaveBeenCalledWith(['vikRequest'], request)
  })

  it('filters existing requests without hiding the currently selected request', async () => {
    const row = {
      id: 1,
      projectTitle: 'Проект А',
      line: 'LINE-1',
      joint: 'F1',
      weldDate: '2026-08-10',
      hasVik: 'дополнительный',
    } as WeldRow
    const createRequest = (name: string, date: string, searchText: string) => ({
      key: JSON.stringify([name, date]),
      name,
      date,
      label: `${name} · ${date}`,
      rowCount: 1,
      positionCount: 1,
      methodCodes: ['ВИК'],
      searchText,
      disabledReason: null,
    })
    const selectedRequest = createRequest('Заявка-001', '2026-08-14', 'проект а line-1 f1')
    const matchingRequest = createRequest('Заявка-777', '2026-08-20', 'проект б line-7 f7')
    const hiddenRequest = createRequest('Заявка-002', '2026-08-15', 'проект в line-2 f2')

    render(
      <LnkRequestDialog
        nextRequestName="Заявка-003"
        selectedRowsCount={1}
        selectedRows={[row]}
        requestNaming={defaultRequestNamingState}
        requestDate="2026-08-14"
        requestExtensionOptions={[selectedRequest, matchingRequest, hiddenRequest]}
        initialMode="extend"
        initialRequestKey={selectedRequest.key}
        initialSelectedMethods={new Set(['vikRequest'])}
        requestSearch=""
        lnkRowsCount={1}
        filteredRows={[row]}
        filteredAvailableRows={[row]}
        availableRows={[row]}
        selectedIds={new Set([row.id])}
        isPending={false}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        onClose={vi.fn()}
        onOpenRequestRegistry={vi.fn()}
        onRequestNamingChange={vi.fn()}
        onRequestDateChange={vi.fn()}
        onRequestSearchChange={vi.fn()}
        onClearSelection={vi.fn()}
        onSetSelectedRows={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onToggleAllRows={vi.fn()}
        onToggleRow={vi.fn()}
        onSubmit={vi.fn()}
        onExtendRequest={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Название, дата, проект или стык'), {
      target: { value: '777' },
    })

    await waitFor(() => expect(screen.getByText('1/3')).toBeInTheDocument())
    expect(screen.getByRole('option', { name: /Заявка-001/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Заявка-777/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Заявка-002/ })).not.toBeInTheDocument()
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
        availableRows={rows}
        selectedIds={new Set()}
        isPending={false}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        onClose={vi.fn()}
        onOpenRequestRegistry={vi.fn()}
        onRequestNamingChange={vi.fn()}
        onRequestDateChange={vi.fn()}
        onRequestSearchChange={vi.fn()}
        onClearSelection={vi.fn()}
        onSetSelectedRows={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onToggleAllRows={vi.fn()}
        onToggleRow={onToggleRow}
        onSubmit={vi.fn()}
        onExtendRequest={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('checkbox').length).toBeLessThan(50)
    expect(screen.getByText('1 из 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница стыков' }))

    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.getByText('51-51')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggleRow).toHaveBeenCalledWith(51)
  })

  it('shows every selected row independently from the current search', () => {
    const rows = [
      { id: 1, line: 'LINE-1', joint: 'F1', weldDate: '2026-08-10', hasVik: 'да' },
      { id: 2, line: 'LINE-2', joint: 'F2', weldDate: '2026-08-10', hasVik: 'да' },
    ] as WeldRow[]
    const onToggleRow = vi.fn()
    const onClearSelection = vi.fn()

    render(
      <LnkRequestDialog
        nextRequestName="Заявка-001"
        selectedRowsCount={2}
        selectedRows={rows}
        requestNaming={defaultRequestNamingState}
        requestDate="2026-08-14"
        requestExtensionOptions={[]}
        initialMode="create"
        initialRequestKey=""
        initialSelectedMethods={new Set(['vikRequest'])}
        requestSearch="LINE-1"
        lnkRowsCount={rows.length}
        filteredRows={[rows[0]]}
        filteredAvailableRows={[rows[0]]}
        availableRows={rows}
        selectedIds={new Set(rows.map((row) => row.id))}
        isPending={false}
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        onClose={vi.fn()}
        onOpenRequestRegistry={vi.fn()}
        onRequestNamingChange={vi.fn()}
        onRequestDateChange={vi.fn()}
        onRequestSearchChange={vi.fn()}
        onClearSelection={onClearSelection}
        onSetSelectedRows={vi.fn()}
        onOpenJournalRows={vi.fn()}
        onToggleAllRows={vi.fn()}
        onToggleRow={onToggleRow}
        onSubmit={vi.fn()}
        onExtendRequest={vi.fn()}
      />,
    )

    expect(screen.queryByText(/LINE-2/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Выбрано: 2' }))

    expect(screen.getByText(/LINE-1/)).toBeInTheDocument()
    expect(screen.getByText(/LINE-2/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Поиск среди выбранных стыков')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: /LINE-2/ }))
    expect(onToggleRow).toHaveBeenCalledWith(2)

    fireEvent.click(screen.getByRole('button', { name: 'Снять весь выбор' }))
    expect(onClearSelection).toHaveBeenCalledTimes(1)
  })
})
