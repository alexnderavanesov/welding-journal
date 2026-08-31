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
  })

  it('contains only stable report counters and no notification block', () => {
    render(<ReportSummaryBar {...createProps()} />)

    expect(screen.getByText(/Стыков на ЛНК: 9/)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('offers an explicit return without replacing the stable counters', () => {
    const onReturnContext = vi.fn()
    render(
      <ReportSummaryBar
        {...createProps()}
        returnContext={{ title: 'Документы' }}
        onReturnContext={onReturnContext}
      />,
    )

    expect(screen.getByText(/Стыков на ЛНК: 9/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться: Документы' }))
    expect(onReturnContext).toHaveBeenCalledTimes(1)
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
