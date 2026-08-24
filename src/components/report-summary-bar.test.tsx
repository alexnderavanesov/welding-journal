import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ReportSummaryBar, type ReportSummaryBarProps } from '@/components/report-summary-bar'

describe('ReportSummaryBar', () => {
  it('keeps navigation messages inside the visible report width', () => {
    render(
      <ReportSummaryBar
        {...createProps()}
        left={288}
        message="Показана линия 330-HBFW-21-000: проверить назначение контроля линии"
      />,
    )

    const message = screen.getByTitle('Показана линия 330-HBFW-21-000: проверить назначение контроля линии')
    const summary = message.parentElement

    expect(summary).toHaveStyle({ left: '288px', width: 'calc(100vw - 312px)' })
    expect(message).toHaveClass('truncate', 'max-w-[60vw]')
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
