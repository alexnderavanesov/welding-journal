import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LnkResultRow } from '@/components/lnk-result-row'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

const renderJointHeading = vi.fn()

vi.mock('@/components/request-row-joint-heading', () => ({
  RequestRowJointHeading: ({ row, stackMetadata }: { row: WeldRow; stackMetadata?: boolean }) => {
    renderJointHeading(row.id, stackMetadata)
    return <span>{String(row.joint)}</span>
  },
}))

describe('LnkResultRow', () => {
  beforeEach(() => {
    renderJointHeading.mockClear()
  })

  it('updates only its own draft mark without toggling joint selection or changing the saved mark', () => {
    const row = { id: 9, line: 'L1', joint: 'F9', connectionType: 'У19', hasPvk: 'да', pvkRequest: 'ПВК-9', pvkRequestDate: '2026-08-26' } as WeldRow
    const props = { row, requestName: '', requestDate: '', methodKey: 'pvkRequest' as const, selected: true,
      rowResult: 'годен', saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS, controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS,
      onToggleRow: vi.fn(), onSetRowResult: vi.fn(), onSetLayeredControl: vi.fn(), onOpenContextMenu: vi.fn() }
    const { rerender } = render(<LnkResultRow {...props} />)
    const checkbox = screen.getByRole('checkbox', { name: 'Послойный контроль: L1 · F9' })
    fireEvent.click(checkbox)
    expect(props.onSetLayeredControl).toHaveBeenCalledWith(9, true)
    expect(props.onToggleRow).not.toHaveBeenCalled()
    rerender(<LnkResultRow {...props} layeredControlSelected />)
    expect(checkbox).toBeChecked()
    expect(screen.getByRole('button', { name: 'вырез' })).toBeDisabled()
    rerender(<LnkResultRow {...props} row={{ ...row, layeredControlAssigned: true }} />)
    expect(checkbox).toBeChecked()
    expect(checkbox).toBeDisabled()
    fireEvent.click(screen.getByText('Послойный контроль'))
    expect(props.onToggleRow).not.toHaveBeenCalled()
    expect(props.onSetLayeredControl).toHaveBeenCalledTimes(1)
    rerender(<LnkResultRow {...props} selected={false} />)
    expect(checkbox).not.toBeChecked()
    expect(checkbox).toBeDisabled()
  })

  it('does not rerender an unchanged unselected row when another draft row changes', () => {
    const row = {
      id: 1,
      joint: 'F1',
      vikRequest: 'Заявка-001',
      vikRequestDate: '2026-08-14',
      vikResult: 'ожидает НК',
    } as WeldRow
    const baseProps = {
      row,
      requestName: '',
      requestDate: '',
      methodKey: 'vikRequest' as const,
      selected: false,
      rowResult: '',
      saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS,
      controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS,
      onToggleRow: vi.fn(),
      onSetRowResult: vi.fn(),
      onOpenContextMenu: vi.fn(),
    }
    const { rerender } = render(<LnkResultRow {...baseProps} />)

    rerender(
      <LnkResultRow
        {...baseProps}
        rowResult="годен"
        onToggleRow={vi.fn()}
        onSetRowResult={vi.fn()}
      />,
    )
    expect(renderJointHeading).toHaveBeenCalledTimes(1)

    rerender(<LnkResultRow {...baseProps} selected rowResult="годен" />)
    expect(renderJointHeading).toHaveBeenCalledTimes(2)
  })

  it('reserves the result column so selecting a row does not change its minimum height', () => {
    const row = {
      id: 2,
      joint: 'F2',
      vikRequest: 'Заявка-002',
      vikRequestDate: '2026-08-26',
      vikResult: 'ожидает НК',
      hasVik: true,
    } as WeldRow
    const props = {
      row,
      requestName: '',
      requestDate: '',
      methodKey: 'vikRequest' as const,
      rowResult: '',
      saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS,
      controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS,
      onToggleRow: vi.fn(),
      onSetRowResult: vi.fn(),
      onOpenContextMenu: vi.fn(),
    }
    const { container, rerender } = render(<LnkResultRow {...props} selected={false} />)

    expect(container.firstElementChild).toHaveClass('min-h-[92px]')
    expect(screen.queryByRole('button', { name: 'годен' })).not.toBeInTheDocument()

    rerender(<LnkResultRow {...props} selected />)

    expect(container.firstElementChild).toHaveClass('min-h-[92px]')
    expect(screen.getByRole('button', { name: 'годен' })).toBeInTheDocument()
  })

  it('lets document badges define the row height and shows complete joint metadata', () => {
    const row = {
      id: 3,
      joint: 'F3',
      vikRequest: 'Заявка-003',
      vikRequestDate: '2026-08-26',
      vikConclusion: 'Заключение-003',
      vikResult: 'ожидает НК',
      hasVik: true,
    } as WeldRow
    const { container } = render(
      <LnkResultRow
        row={row}
        requestName=""
        requestDate=""
        methodKey="vikRequest"
        selected={false}
        rowResult=""
        saveCheckSettings={DEFAULT_SAVE_CHECK_SETTINGS}
        controlProcessSettings={DEFAULT_CONTROL_PROCESS_SETTINGS}
        onToggleRow={vi.fn()}
        onSetRowResult={vi.fn()}
        onOpenContextMenu={vi.fn()}
      />,
    )

    expect(renderJointHeading).toHaveBeenLastCalledWith(3, true)
    expect(screen.getByText('Заявка-003').parentElement?.parentElement?.parentElement).not.toHaveClass(
      'max-h-[58px]',
      'overflow-y-auto',
    )
    expect(container.firstElementChild).toHaveClass('min-h-[92px]')
  })
})
