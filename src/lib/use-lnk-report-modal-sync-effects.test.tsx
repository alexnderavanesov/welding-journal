import { useState } from 'react'
import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useLnkReportModalSyncEffects } from './use-lnk-report-modal-sync-effects'
import { createDefaultLnkResultDraft, type LnkResultDraftState } from './report-draft-state'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from './control-process-settings'
import type { WeldRow } from './dispatcher-types'

it('keeps mixed selected requests, method and values when the candidate filter has no matches', () => {
  const rows = [1, 2].map(id => ({ id, hasVik: 'да', vikRequest: `REQ-${id}`, vikRequestDate: '2026-09-01' })) as WeldRow[]
  const draft = { ...createDefaultLnkResultDraft(), methodKey: 'vikRequest' as const, requestName: 'Unrelated request', requestDate: '2026-09-02', rowIds: new Set([1, 2]), rowResults: { 1: 'годен', 2: 'ремонт' } }
  const { result, rerender } = renderHook(({ contextRows, ready }) => {
    const [state, setState] = useState<LnkResultDraftState>(draft)
    useLnkReportModalSyncEffects({
      availableLnkRequestRows: [], controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS,
      isLnkRowsContextReady: ready, isLnkRequestModalOpen: false, isLnkResultManagerOpen: false, isLnkResultModalOpen: true,
      lnkRows: contextRows, managedLnkResultEntries: [], managedLnkResultMethodKey: '', managedLnkResultMethods: [],
      setLnkResultDraft: setState, setManagedLnkConclusionDrafts: vi.fn(), setManagedLnkResultMethodKey: vi.fn(), setSelectedLnkIds: vi.fn(),
    })
    return state
  }, { initialProps: { contextRows: rows, ready: true } })
  expect(result.current).toEqual(draft)
  rerender({ contextRows: [], ready: false })
  expect(result.current).toEqual(draft)
  rerender({ contextRows: [...rows], ready: true })
  expect(result.current).toEqual(draft)
})
