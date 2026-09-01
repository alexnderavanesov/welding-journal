import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { readSortByReport, useReportSortState } from '@/lib/use-report-sort-state'

describe('useReportSortState', () => {
  beforeEach(() => window.localStorage.clear())

  it('keeps a separate sort for every report', () => {
    const { result, rerender } = renderHook(
      ({ report }) => useReportSortState(report),
      { initialProps: { report: 'lnk' as const } },
    )
    act(() => result.current.setSort({ fieldKey: 'weldDate', direction: 'desc' }))
    expect(result.current.sort).toEqual({ fieldKey: 'weldDate', direction: 'desc' })

    rerender({ report: 'heatTreatment' as never })
    expect(result.current.sort).toBeNull()
    act(() => result.current.setSort({ fieldKey: 'pstoDate', direction: 'asc' }))

    rerender({ report: 'lnk' as never })
    expect(result.current.sort).toEqual({ fieldKey: 'weldDate', direction: 'desc' })
  })

  it('ignores obsolete and virtual sort fields restored from the browser', () => {
    window.localStorage.setItem('welding-report-sort:v1', JSON.stringify({
      weldingJournal: { fieldKey: 'missingField', direction: 'asc' },
      lnk: { fieldKey: 'dispatcherTasks', direction: 'desc' },
      heatTreatment: { fieldKey: 'pstoDate', direction: 'desc' },
    }))

    expect(readSortByReport()).toEqual({
      heatTreatment: { fieldKey: 'pstoDate', direction: 'desc' },
    })
  })

  it('migrates the former status sort key to officiality', () => {
    window.localStorage.setItem('welding-report-sort:v1', JSON.stringify({
      weldingJournal: { fieldKey: 'status', direction: 'asc' },
    }))

    expect(readSortByReport()).toEqual({
      weldingJournal: { fieldKey: 'officiality', direction: 'asc' },
    })
  })
})
