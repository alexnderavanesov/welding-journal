import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useEscapeToClearReportFilters } from '@/lib/report-page-effects'

describe('useEscapeToClearReportFilters', () => {
  afterEach(() => {
    document.querySelectorAll('[data-modal-dialog="true"]').forEach((node) => node.remove())
  })

  it('closes the modal layer before clearing selected report rows', () => {
    const setSelectedWeldingJournalIds = vi.fn()
    const modal = document.createElement('div')
    modal.dataset.modalDialog = 'true'
    document.body.append(modal)

    renderHook(() =>
      useEscapeToClearReportFilters({
        activeReport: 'weldingJournal',
        editingOpen: false,
        isReportModalOpen: false,
        chainOpen: false,
        selectedWeldingJournalIds: new Set([10, 20]),
        selectedLnkIds: new Set(),
        selectedHeatTreatmentIds: new Set(),
        columnFilters: {},
        heatTreatmentFilters: {},
        lnkFilters: {},
        setSelectedWeldingJournalIds,
        setSelectedLnkIds: vi.fn(),
        setSelectedHeatTreatmentIds: vi.fn(),
        setColumnFilters: vi.fn(),
        setHeatTreatmentFilters: vi.fn(),
        setLnkFilters: vi.fn(),
      }),
    )

    pressEscape()
    expect(setSelectedWeldingJournalIds).not.toHaveBeenCalled()

    modal.remove()
    pressEscape()
    expect(setSelectedWeldingJournalIds).toHaveBeenCalledOnce()
    expect(setSelectedWeldingJournalIds).toHaveBeenCalledWith(new Set())
  })
})

function pressEscape() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
}
