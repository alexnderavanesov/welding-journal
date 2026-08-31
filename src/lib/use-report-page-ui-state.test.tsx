import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useReportPageUiState } from '@/lib/use-report-page-ui-state'

describe('useReportPageUiState', () => {
  it('keeps the selected documents view while another report is open', () => {
    const { result } = renderHook(() => useReportPageUiState())

    expect(result.current.documentsPageType).toBe('weldingJournal')

    act(() => result.current.setDocumentsPageType('lnkRequest'))

    expect(result.current.documentsPageType).toBe('lnkRequest')
  })
})
