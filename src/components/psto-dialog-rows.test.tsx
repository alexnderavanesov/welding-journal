import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PstoRequestRow } from '@/components/psto-request-row'
import { PstoResultRow } from '@/components/psto-result-row'
import type { WeldRow } from '@/lib/dispatcher-types'

const renderRequestHeading = vi.fn()
const renderResultHeading = vi.fn()

vi.mock('@/components/request-row-joint-heading', () => ({
  RequestRowJointHeading: ({ row }: { row: WeldRow }) => {
    renderRequestHeading(row.id)
    return <span>{String(row.joint)}</span>
  },
}))

vi.mock('@/components/result-row-joint-heading', () => ({
  ResultRowJointHeading: ({ row }: { row: WeldRow }) => {
    renderResultHeading(row.id)
    return <span>{String(row.joint)}</span>
  },
}))

describe('PSTO dialog rows', () => {
  beforeEach(() => {
    renderRequestHeading.mockClear()
    renderResultHeading.mockClear()
  })

  it('does not rerender an unchanged request row when the parent callback changes', () => {
    const row = { id: 1, joint: 'F1', pstoRequired: 'да' } as WeldRow
    const onOpenContextMenu = vi.fn()
    const { rerender } = render(
      <PstoRequestRow row={row} selected={false} disabled={false} onToggleRow={vi.fn()} onOpenContextMenu={onOpenContextMenu} />,
    )

    rerender(<PstoRequestRow row={row} selected={false} disabled={false} onToggleRow={vi.fn()} onOpenContextMenu={onOpenContextMenu} />)
    expect(renderRequestHeading).toHaveBeenCalledTimes(1)

    rerender(<PstoRequestRow row={row} selected disabled={false} onToggleRow={vi.fn()} onOpenContextMenu={onOpenContextMenu} />)
    expect(renderRequestHeading).toHaveBeenCalledTimes(2)
  })

  it('does not rerender an unchanged result row when the parent callback changes', () => {
    const row = {
      id: 1,
      joint: 'F1',
      pstoRequest: 'ПСТО-001',
      pstoResult: 'ожидает ПСТО',
    } as WeldRow
    const onOpenContextMenu = vi.fn()
    const { rerender } = render(
      <PstoResultRow row={row} selected={false} disabled={false} onToggle={vi.fn()} onOpenContextMenu={onOpenContextMenu} />,
    )

    rerender(<PstoResultRow row={row} selected={false} disabled={false} onToggle={vi.fn()} onOpenContextMenu={onOpenContextMenu} />)
    expect(renderResultHeading).toHaveBeenCalledTimes(1)

    rerender(<PstoResultRow row={row} selected disabled={false} onToggle={vi.fn()} onOpenContextMenu={onOpenContextMenu} />)
    expect(renderResultHeading).toHaveBeenCalledTimes(2)
  })

  it('shows the complete PSTO request and conclusion in a height-aware row', () => {
    const row = {
      id: 2,
      joint: 'F2',
      pstoRequest: 'Заявка-ПСТО-002',
      heatTreatmentDiagram: 'Заключение-ПСТО-002',
      pstoResult: 'ожидает ПСТО',
    } as WeldRow
    const { container } = render(
      <PstoResultRow row={row} selected={false} disabled={false} onToggle={vi.fn()} onOpenContextMenu={vi.fn()} />,
    )

    expect(container.firstElementChild).toHaveClass('min-h-[92px]')
    expect(screen.getByText('ПСТО')).toHaveClass('shrink-0')
    expect(screen.getByText('Заявка-ПСТО-002')).toHaveClass('break-words')
    expect(screen.getByText('Заключение-ПСТО-002')).toHaveClass('break-words')
    expect(screen.getByText('Заявка-ПСТО-002').parentElement?.parentElement?.parentElement).not.toHaveClass(
      'max-h-[58px]',
      'overflow-y-auto',
    )
  })
})
