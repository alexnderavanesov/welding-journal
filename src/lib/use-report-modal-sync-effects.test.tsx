import { useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { createDefaultLnkResultDraft, createDefaultPstoResultDraft } from '@/lib/report-draft-state'
import { useLnkReportModalSyncEffects } from '@/lib/use-lnk-report-modal-sync-effects'
import { usePstoReportModalSyncEffects } from '@/lib/use-psto-report-modal-sync-effects'

describe('report modal context loading', () => {
  it('does not loop when an open LNK result receives equivalent context arrays', () => {
    const { result } = renderHook(() => {
      const [draft, setDraft] = useState(() => createDefaultLnkResultDraft())
      useLnkReportModalSyncEffects({
        availableLnkRequestRows: [],
        isLnkRowsContextReady: true,
        isLnkRequestModalOpen: false,
        isLnkResultManagerOpen: false,
        isLnkResultModalOpen: true,
        lnkResultRequestOptions: [],
        lnkRows: [{ id: 7 }] as WeldRow[],
        managedLnkResultEntries: [],
        managedLnkResultMethodKey: '',
        managedLnkResultMethods: [],
        setLnkResultDraft: setDraft,
        setManagedLnkConclusionDrafts: () => undefined,
        setManagedLnkResultMethodKey: () => undefined,
        setSelectedLnkIds: () => undefined,
      })
      return draft
    })

    expect(result.current.rowIds.size).toBe(0)
  })

  it('does not overwrite an edited LNK conclusion draft when report rows rerender', () => {
    const row = {
      id: 7,
      vikConclusion: 'Заключение-001',
    } as WeldRow
    const method = {
      requestKey: 'vikRequest' as const,
      conclusionKey: 'vikConclusion' as const,
    }
    const { result, rerender } = renderHook(
      ({ entries }) => {
        const [drafts, setDrafts] = useState<Record<string, string>>({})
        useLnkReportModalSyncEffects({
          availableLnkRequestRows: [],
          isLnkRowsContextReady: true,
          isLnkRequestModalOpen: false,
          isLnkResultManagerOpen: true,
          isLnkResultModalOpen: false,
          lnkResultRequestOptions: [],
          lnkRows: [row],
          managedLnkResultEntries: entries,
          managedLnkResultMethodKey: '',
          managedLnkResultMethods: [],
          setLnkResultDraft: vi.fn(),
          setManagedLnkConclusionDrafts: setDrafts,
          setManagedLnkResultMethodKey: vi.fn(),
          setSelectedLnkIds: vi.fn(),
        })
        return { drafts, setDrafts }
      },
      {
        initialProps: {
          entries: [{ row, method, changeKey: '7:vikRequest' }],
        },
      },
    )

    expect(result.current.drafts).toEqual({ '7:vikRequest': 'Заключение-001' })

    act(() => {
      result.current.setDrafts({ '7:vikRequest': 'Заключение заказчика №77' })
    })
    act(() => {
      rerender({ entries: [{ row: { ...row }, method: { ...method }, changeKey: '7:vikRequest' }] })
    })

    expect(result.current.drafts).toEqual({ '7:vikRequest': 'Заключение заказчика №77' })
  })

  it('does not loop when an open PSTO result receives equivalent context arrays', () => {
    const { result } = renderHook(() => {
      const [draft, setDraft] = useState(() => createDefaultPstoResultDraft())
      usePstoReportModalSyncEffects({
        availablePstoRequestRows: [],
        heatTreatmentRows: [{ id: 8 }] as WeldRow[],
        isPstoRowsContextReady: true,
        isPstoRequestModalOpen: false,
        isPstoResultManagerOpen: false,
        isPstoResultModalOpen: true,
        managedPstoResultRows: [],
        pstoResultRequestOptions: [],
        setManagedPstoDiagramDrafts: () => undefined,
        setPstoResultDraft: setDraft,
        setSelectedHeatTreatmentIds: () => undefined,
      })
      return draft
    })

    expect(result.current.rowIds.size).toBe(0)
  })

  it('keeps an LNK row selected until the fresh report context is ready', () => {
    const setSelectedLnkIds = vi.fn()
    const { rerender } = renderHook(
      ({ ready, rows }) => useLnkReportModalSyncEffects({
        availableLnkRequestRows: rows,
        isLnkRowsContextReady: ready,
        isLnkRequestModalOpen: true,
        isLnkResultManagerOpen: false,
        isLnkResultModalOpen: false,
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
