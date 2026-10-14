import { describe, expect, it, vi } from 'vitest'

import { createReportSummaryBarProps } from '@/lib/report-summary-props'
import { getReportSummaryText } from '@/lib/report-display-state'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('createReportSummaryBarProps', () => {
  it('passes a row refresh failure and its explicit retry separately from summary retry', () => {
    const onRetryRows = vi.fn(), onRetrySummary = vi.fn()
    const props = createReportSummaryBarProps({
      activeReport: 'lnk', left: 0, isLoading: false, summaryStatus: 'error',
      rowsError: 'Network unavailable', onRetryRows, onRetrySummary,
      weldingRows: [], acceptedWdiTotal: undefined, heatTreatmentRows: [], selectedHeatTreatmentRowCount: 0,
      lnkRows: [], availableLnkRequestRows: [], welderStamps: [], filteredWelderStamps: [],
    })
    expect(props.rowsError).toBe('Network unavailable')
    expect(props.onRetryRows).toBe(onRetryRows)
    expect(props.onRetrySummary).toBe(onRetrySummary)
    expect(props.lnkRowCount).toBeUndefined()
  })
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

  it.each(['pending', 'error', 'ready'] as const)('does not replace unknown %s totals with the loaded row count or zero', (summaryStatus) => {
    const rows = [{ id: 1 }, { id: 2 }] as WeldRow[]
    const props = createReportSummaryBarProps({
      activeReport: 'lnk', left: 0, isLoading: false, summaryStatus,
      weldingRows: rows, acceptedWdiTotal: undefined,
      heatTreatmentRows: rows, selectedHeatTreatmentRowCount: 7,
      lnkRows: rows, availableLnkRequestRows: rows, welderStamps: [], filteredWelderStamps: [],
    })
    expect(props.weldingRowCount).toBeUndefined()
    expect(props.heatTreatmentRowCount).toBeUndefined()
    expect(props.lnkRowCount).toBeUndefined()
    expect(props.availableLnkRequestRowCount).toBeUndefined()
    expect(props.acceptedWdiTotalText).toBe('Недоступно')
    expect(getReportSummaryText(props)).toBe(summaryStatus === 'pending' ? 'Идёт подсчёт…'
      : summaryStatus === 'error' ? 'Не удалось подсчитать итоги'
      : 'Стыков на ЛНК: Недоступно · Доступно для основной заявки: Недоступно')
    expect(getReportSummaryText({ ...props, activeReport: 'heatTreatment' })).toContain('Выбрано: 7')
  })

  it('displays a confirmed zero as zero, including WDI, without using the loaded rows', () => {
    const props = createReportSummaryBarProps({
      activeReport: 'weldingJournal', left: 0, isLoading: false, summaryStatus: 'ready',
      weldingRows: [{ id: 1 }] as WeldRow[], weldingRowCount: 0, acceptedWdiTotal: 0,
      heatTreatmentRows: [], selectedHeatTreatmentRowCount: 0,
      lnkRows: [], lnkRowCount: 0, availableLnkRequestRows: [], availableLnkRequestRowCount: 0,
      welderStamps: [], filteredWelderStamps: [],
    })
    expect(props.weldingRowCount).toBe(0)
    expect(props.acceptedWdiTotalText).toBe('0')
    expect(getReportSummaryText(props)).toBe('Записей: 0 · WDI годных: 0')
    expect(getReportSummaryText({ ...props, activeReport: 'lnk' })).toBe('Стыков на ЛНК: 0 · Доступно для основной заявки: 0')
  })
})
