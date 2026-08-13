import { describe, expect, it } from 'vitest'

import { createReportSummaryBarProps } from '@/lib/report-summary-props'

describe('createReportSummaryBarProps', () => {
  it('uses explicit server counts instead of client row array length', () => {
    const props = createReportSummaryBarProps({
      activeReport: 'lnk',
      left: 0,
      minWidth: 0,
      isLoading: false,
      weldingRows: [],
      weldingRowCount: 123,
      acceptedWdiTotal: 0,
      heatTreatmentRows: [],
      heatTreatmentRowCount: 45,
      selectedHeatTreatmentRows: [],
      lnkRows: [],
      lnkRowCount: 67,
      availableLnkRequestRows: [],
      availableLnkRequestRowCount: 56,
      welderStamps: [],
      filteredWelderStamps: [],
    })

    expect(props.weldingRowCount).toBe(123)
    expect(props.heatTreatmentRowCount).toBe(45)
    expect(props.lnkRowCount).toBe(67)
    expect(props.availableLnkRequestRowCount).toBe(56)
  })
})
