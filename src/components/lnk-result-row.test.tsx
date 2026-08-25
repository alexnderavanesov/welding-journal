import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LnkResultRow } from '@/components/lnk-result-row'
import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

const renderJointHeading = vi.fn()

vi.mock('@/components/result-row-joint-heading', () => ({
  ResultRowJointHeading: ({ row }: { row: WeldRow }) => {
    renderJointHeading(row.id)
    return <span>{String(row.joint)}</span>
  },
}))

describe('LnkResultRow', () => {
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
      onToggleRow: vi.fn(),
      onSetRowResult: vi.fn(),
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
})
