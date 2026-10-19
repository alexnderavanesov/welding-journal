import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useEscapeToClearReportFilters } from '@/lib/report-page-effects'
import { JournalGridToolbar } from '@/components/welding-journal-grid-toolbar'
import { useWeldReportViewState } from './use-weld-report-view-state'
import { DEFAULT_JOURNAL_APPEARANCE } from './welding-journal-grid-state'
import { ROW_ID_LIST_FILTER_KEY } from '@/lib/report-navigation'

describe('useEscapeToClearReportFilters', () => {
  it('does not consume Escape or clear hidden journal filters in Documents', () => {
    const clear = vi.fn()
    renderHook(() => useEscapeToClearReportFilters({
      activeReport: 'documents', editingOpen: false, isReportModalOpen: false, chainOpen: false,
      selectedWeldingJournalIds: new Set([1]), selectedLnkIds: new Set(), selectedHeatTreatmentIds: new Set(),
      columnFilters: { projectTitle: 'Journal project' }, heatTreatmentFilters: {}, lnkFilters: {},
      setSelectedWeldingJournalIds: clear, setSelectedLnkIds: clear, setSelectedHeatTreatmentIds: clear,
      setColumnFilters: clear, setHeatTreatmentFilters: clear, setLnkFilters: clear,
    }))
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    act(() => { window.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(false)
    expect(clear).not.toHaveBeenCalled()
  })
  afterEach(() => {
    document.querySelectorAll('[data-modal-dialog="true"], [data-test-report-dialog]').forEach((node) => node.remove())
  })

  it.each(['weldingJournal', 'lnk', 'heatTreatment'] as const)(
    'closes grid settings without clearing %s search, then clears normally on the next Escape', (activeReport) => {
      const clearFilters = vi.fn(), clearSelection = vi.fn()
      renderHook(() => useEscapeToClearReportFilters({
        activeReport, editingOpen: false, isReportModalOpen: false, chainOpen: false,
        selectedWeldingJournalIds: new Set(), selectedLnkIds: new Set(), selectedHeatTreatmentIds: new Set(),
        columnFilters: { search: 'F970', line: 'L1' }, heatTreatmentFilters: { search: 'F970', line: 'L1' },
        lnkFilters: { search: 'F970', line: 'L1' },
        setSelectedWeldingJournalIds: clearSelection, setSelectedLnkIds: clearSelection, setSelectedHeatTreatmentIds: clearSelection,
        setColumnFilters: clearFilters, setHeatTreatmentFilters: clearFilters, setLnkFilters: clearFilters,
      }))
      render(<TestGridToolbar />)
      fireEvent.click(screen.getByRole('button', { name: 'Настроить вид' }))
      const panel = screen.getByRole('dialog', { name: 'Настройка вида' })
      fireEvent.keyDown(panel.querySelector('input')!, { key: 'Escape', bubbles: true, cancelable: true })
      expect(panel).not.toBeInTheDocument()
      expect(clearFilters).not.toHaveBeenCalled()
      expect(clearSelection).not.toHaveBeenCalled()
      pressEscape()
      expect(clearFilters).toHaveBeenCalledExactlyOnceWith({})
    },
  )

  it('preserves selection and the row-ID filter behind a dialog, without changing their normal Escape priority', () => {
    const clearFilters = vi.fn(), clearSelection = vi.fn()
    const panel = document.createElement('div')
    panel.setAttribute('role', 'dialog')
    panel.dataset.testReportDialog = ''
    document.body.append(panel)
    const { rerender } = renderHook(({ selected }) => useEscapeToClearReportFilters({
      activeReport: 'lnk', editingOpen: false, isReportModalOpen: false, chainOpen: false,
      selectedWeldingJournalIds: new Set(), selectedLnkIds: selected, selectedHeatTreatmentIds: new Set(),
      columnFilters: {}, heatTreatmentFilters: {}, lnkFilters: { search: 'F970', [ROW_ID_LIST_FILTER_KEY]: '1,2' },
      setSelectedWeldingJournalIds: clearSelection, setSelectedLnkIds: clearSelection, setSelectedHeatTreatmentIds: clearSelection,
      setColumnFilters: clearFilters, setHeatTreatmentFilters: clearFilters, setLnkFilters: clearFilters,
    }), { initialProps: { selected: new Set([1, 2]) } })
    pressEscape()
    expect(clearSelection).not.toHaveBeenCalled()
    expect(clearFilters).not.toHaveBeenCalled()
    panel.remove()
    pressEscape()
    expect(clearSelection).toHaveBeenCalledExactlyOnceWith(new Set())
    expect(clearFilters).not.toHaveBeenCalled()
    rerender({ selected: new Set() })
    pressEscape()
    expect(clearFilters).toHaveBeenCalledExactlyOnceWith({ search: 'F970' })
  })

  it.each(['hidden', 'aria-hidden'] as const)('does not let a dialog in a %s container disable ordinary filter clearing', (attribute) => {
    const clearFilters = vi.fn(), clearSelection = vi.fn()
    const container = document.createElement('div')
    container.dataset.testReportDialog = ''
    container.setAttribute(attribute, 'true')
    const panel = document.createElement('div')
    panel.setAttribute('role', 'dialog')
    container.append(panel)
    document.body.append(container)
    renderHook(() => useEscapeToClearReportFilters({
      activeReport: 'lnk', editingOpen: false, isReportModalOpen: false, chainOpen: false,
      selectedWeldingJournalIds: new Set(), selectedLnkIds: new Set(), selectedHeatTreatmentIds: new Set(),
      columnFilters: {}, heatTreatmentFilters: {}, lnkFilters: { search: 'F970' },
      setSelectedWeldingJournalIds: clearSelection, setSelectedLnkIds: clearSelection, setSelectedHeatTreatmentIds: clearSelection,
      setColumnFilters: clearFilters, setHeatTreatmentFilters: clearFilters, setLnkFilters: clearFilters,
    }))
    pressEscape()
    expect(clearFilters).toHaveBeenCalledExactlyOnceWith({})
    expect(clearSelection).not.toHaveBeenCalled()
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

function TestGridToolbar() {
  const view = useWeldReportViewState({ storageKey: 'test-grid', sections: [], alwaysVisibleFieldKeys: new Set(),
    defaultCollapsedSections: new Set(), columnFilters: {}, sort: null, onColumnFiltersChange: vi.fn(), onSortChange: vi.fn() })
  return <JournalGridToolbar settingsLabel="Настройка вида" sections={[]} extraSections={[]} alwaysVisible={new Set()}
    view={view} openColumnsRequest={0} appearance={DEFAULT_JOURNAL_APPEARANCE} onAppearanceChange={vi.fn()}
    onResetLayout={vi.fn()} hasFilters={false} onClearFilters={vi.fn()} />
}
