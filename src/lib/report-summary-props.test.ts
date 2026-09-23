import { describe, expect, it } from 'vitest'

import { createReportSummaryBarProps } from '@/lib/report-summary-props'

describe('createReportSummaryBarProps', () => {
  it('uses explicit server counts instead of client row array length', () => {
    const props = createReportSummaryBarProps({
      activeReport: 'lnk',
      left: 0,
      isLoading: false,
      weldingRows: [],
      weldingRowCount: 123,
      acceptedWdiTotal: 0,
      heatTreatmentRows: [],
      heatTreatmentRowCount: 45,
      selectedHeatTreatmentRowCount: 3,
      lnkRows: [],
      lnkRowCount: 67,
      availableLnkRequestRows: [],
      availableLnkRequestRowCount: 56,
      welderStamps: [],
      filteredWelderStamps: [],
    })

    expect(props.weldingRowCount).toBe(123)
    expect(props.heatTreatmentRowCount).toBe(45)
    expect(props.selectedHeatTreatmentRowCount).toBe(3)
    expect(props.lnkRowCount).toBe(67)
    expect(props.availableLnkRequestRowCount).toBe(56)
  })

  it('marks a previously saved WDI sum while final statuses are recalculated', () => {
    const props = createReportSummaryBarProps({
      activeReport: 'weldingJournal', left: 0, isLoading: false,
      weldingRows: [], acceptedWdiTotal: 42, isAcceptedWdiRecalculating: true,
      heatTreatmentRows: [], selectedHeatTreatmentRowCount: 0,
      lnkRows: [], availableLnkRequestRows: [], welderStamps: [], filteredWelderStamps: [],
    })
    expect(props.acceptedWdiTotalText).toContain('пересчёт')
  })
})
