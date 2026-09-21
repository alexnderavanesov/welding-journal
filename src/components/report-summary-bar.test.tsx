import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ReportSummaryBar, type ReportSummaryBarProps } from '@/components/report-summary-bar'

describe('ReportSummaryBar', () => {
  it('keeps the stable report summary inside the visible report width', () => {
    render(
      <ReportSummaryBar
        {...createProps()}
        left={288}
      />,
    )

    const summary = screen.getByText(/Стыков на ЛНК: 9/)

    expect(summary.parentElement).toHaveStyle({ left: '288px', width: 'calc(100vw - 312px)' })
    expect(summary.parentElement).toHaveClass('h-8', 'overflow-hidden', 'bg-[#f4f7f9]', 'isolate')
    expect(summary.parentElement).not.toHaveClass('backdrop-blur-sm')
    expect(summary).toHaveClass('block', 'leading-5')
  })

  it('contains only stable report counters and no notification block', () => {
    render(<ReportSummaryBar {...createProps()} />)

    expect(screen.getByText(/Стыков на ЛНК: 9/)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('drops independent positioning when embedded into the page header', () => {
    render(<ReportSummaryBar {...createProps()} left={288} embedded />)

    const summary = screen.getByText(/Стыков на ЛНК: 9/).parentElement
    expect(summary).not.toHaveClass('sticky', 'bg-[#f4f7f9]')
    expect(summary).not.toHaveAttribute('style')
  })

  it('updates and clears the report quick search without clearing other filters', () => {
    const onQuickSearchChange = vi.fn()
    const { rerender } = render(
      <ReportSummaryBar
        {...createProps()}
        quickSearchValue="S13"
        onQuickSearchChange={onQuickSearchChange}
      />,
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }), {
      target: { value: 'линия 2' },
    })
    expect(onQuickSearchChange).toHaveBeenLastCalledWith('линия 2')

    rerender(
      <ReportSummaryBar
        {...createProps()}
        quickSearchValue="S13"
        onQuickSearchChange={onQuickSearchChange}
      />,
    )
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }), { key: 'Escape' })
    expect(onQuickSearchChange).toHaveBeenLastCalledWith('')
  })
})

function createProps(): ReportSummaryBarProps {
  return {
    activeReport: 'lnk',
    left: 0,
    isLoading: false,
    weldingRowCount: 0,
    acceptedWdiTotalText: '0',
    heatTreatmentRowCount: 0,
    selectedHeatTreatmentRowCount: 0,
    lnkRowCount: 9,
    availableLnkRequestRowCount: 8,
    activeWelderStampCount: 0,
    archivedWelderStampCount: 0,
    filteredWelderStampCount: 0,
  }
}
