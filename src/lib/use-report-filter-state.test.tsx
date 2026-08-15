import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ActiveReport } from '@/lib/home-state'
import { useReportFilterState } from '@/lib/use-report-filter-state'

describe('useReportFilterState', () => {
  it('keeps the existing uncontrolled behavior', () => {
    const { result } = renderHook(() => useReportFilterState())

    act(() => result.current.setActiveReport('lnk'))

    expect(result.current.activeReport).toBe('lnk')
  })

  it('reports a controlled route change and follows the route prop', () => {
    const onActiveReportChange = vi.fn()
    const { result, rerender } = renderHook(
      ({ activeReport }: { activeReport: ActiveReport }) =>
        useReportFilterState({ activeReport, onActiveReportChange }),
      { initialProps: { activeReport: 'lnk' as ActiveReport } },
    )

    act(() => result.current.setActiveReport('settings'))
    expect(onActiveReportChange).toHaveBeenCalledWith('settings')
    expect(result.current.activeReport).toBe('lnk')

    rerender({ activeReport: 'settings' })
    expect(result.current.activeReport).toBe('settings')
  })

  it('does not navigate when the requested report is already active', () => {
    const onActiveReportChange = vi.fn()
    const { result } = renderHook(() =>
      useReportFilterState({ activeReport: 'documents', onActiveReportChange }),
    )

    act(() => result.current.setActiveReport((current) => current))
    expect(onActiveReportChange).not.toHaveBeenCalled()
  })
})
