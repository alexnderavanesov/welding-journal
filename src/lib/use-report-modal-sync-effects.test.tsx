import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { useLnkReportModalSyncEffects } from '@/lib/use-lnk-report-modal-sync-effects'
import { usePstoReportModalSyncEffects } from '@/lib/use-psto-report-modal-sync-effects'

describe('report modal context loading', () => {
  it('keeps an LNK row selected until the fresh report context is ready', () => {
    const setSelectedLnkIds = vi.fn()
    const { rerender } = renderHook(
      ({ ready, rows }) => useLnkReportModalSyncEffects({
        availableLnkRequestRows: rows,
        isLnkRowsContextReady: ready,
        isLnkRequestModalOpen: true,
        isLnkResultManagerOpen: false,
        isLnkResultModalOpen: false,
        lnkRequestOptions: [],
        lnkResultRequestOptions: [],
        lnkRows: rows,
        managedLnkResultEntries: [],
        managedLnkResultMethodKey: '',
        managedLnkResultMethods: [],
        setLnkResultDraft: vi.fn(),
        setManagedLnkConclusionDrafts: vi.fn(),
        setManagedLnkResultMethodKey: vi.fn(),
        setSelectedLnkIds,
      }),
      { initialProps: { ready: false, rows: [] as WeldRow[] } },
    )

    expect(setSelectedLnkIds).not.toHaveBeenCalled()

    act(() => rerender({ ready: true, rows: [{ id: 7 }] as WeldRow[] }))
    const updater = setSelectedLnkIds.mock.calls.at(-1)?.[0] as (current: Set<number>) => Set<number>
    expect([...updater(new Set([7]))]).toEqual([7])
  })

  it('keeps a PSTO row selected until the fresh report context is ready', () => {
    const setSelectedHeatTreatmentIds = vi.fn()
    const { rerender } = renderHook(
      ({ ready, rows }) => usePstoReportModalSyncEffects({
        availablePstoRequestRows: rows,
        heatTreatmentRows: rows,
        isPstoRowsContextReady: ready,
        isPstoRequestModalOpen: true,
        isPstoResultManagerOpen: false,
        isPstoResultModalOpen: false,
        managedPstoResultRows: [],
        pstoResultRequestOptions: [],
        setManagedPstoDiagramDrafts: vi.fn(),
        setPstoResultDraft: vi.fn(),
        setSelectedHeatTreatmentIds,
      }),
      { initialProps: { ready: false, rows: [] as WeldRow[] } },
    )

    expect(setSelectedHeatTreatmentIds).not.toHaveBeenCalled()

    act(() => rerender({ ready: true, rows: [{ id: 8 }] as WeldRow[] }))
    const updater = setSelectedHeatTreatmentIds.mock.calls.at(-1)?.[0] as (current: Set<number>) => Set<number>
    expect([...updater(new Set([8]))]).toEqual([8])
  })
})
