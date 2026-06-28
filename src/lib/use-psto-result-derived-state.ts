import { useMemo } from 'react'
import type { PstoResultDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  getFilteredPstoResultRequestOptions,
  getFilteredPstoResultRows,
  getManagedPstoResultRows,
  getPstoResultAvailableRequestOptions,
  getPstoResultSaveBlockReason,
  getPstoResultSearchRows,
  getSelectedPstoResultRows,
} from '@/lib/psto-result-derived-utils'

type PstoResultDerivedStateParams = {
  heatTreatmentRows: WeldRow[]
  pstoResultSelectedRows: WeldRow[]
  pstoResultRequestOptions: string[]
  pstoResultRequestSearch: string
  selectedPstoResultRequestRows: WeldRow[]
  pstoResultDraft: PstoResultDraftState
  nextPstoDiagramName: string
  isPstoResultSaving: boolean
}

export function usePstoResultDerivedState({
  heatTreatmentRows,
  pstoResultSelectedRows,
  pstoResultRequestOptions,
  pstoResultRequestSearch,
  selectedPstoResultRequestRows,
  pstoResultDraft,
  nextPstoDiagramName,
  isPstoResultSaving,
}: PstoResultDerivedStateParams) {
  const pstoResultAvailableRequestOptions = useMemo(
    () => getPstoResultAvailableRequestOptions(pstoResultSelectedRows, pstoResultRequestOptions),
    [pstoResultRequestOptions, pstoResultSelectedRows],
  )

  const filteredPstoResultRequestOptions = useMemo(
    () => getFilteredPstoResultRequestOptions(pstoResultAvailableRequestOptions, pstoResultRequestSearch),
    [pstoResultAvailableRequestOptions, pstoResultRequestSearch],
  )

  const pstoResultSearchRows = getPstoResultSearchRows({
    heatTreatmentRows,
    selectedRequestRows: selectedPstoResultRequestRows,
    draft: pstoResultDraft,
  })

  const filteredPstoResultRows = useMemo(
    () => getFilteredPstoResultRows(pstoResultSearchRows, pstoResultDraft),
    [pstoResultDraft, pstoResultSearchRows],
  )

  const selectedPstoResultRows = useMemo(
    () => getSelectedPstoResultRows(filteredPstoResultRows, pstoResultDraft),
    [filteredPstoResultRows, pstoResultDraft.requestName, pstoResultDraft.rowIds],
  )

  const pstoResultSaveBlockReason = useMemo(
    () =>
      getPstoResultSaveBlockReason({
        draft: pstoResultDraft,
        isSaving: isPstoResultSaving,
        nextDiagramName: nextPstoDiagramName,
        selectedRows: selectedPstoResultRows,
      }),
    [isPstoResultSaving, nextPstoDiagramName, pstoResultDraft, selectedPstoResultRows],
  )

  const managedPstoResultRows = useMemo(
    () => getManagedPstoResultRows(heatTreatmentRows, pstoResultDraft.rowIds),
    [heatTreatmentRows, pstoResultDraft.rowIds],
  )

  return {
    pstoResultAvailableRequestOptions,
    filteredPstoResultRequestOptions,
    filteredPstoResultRows,
    selectedPstoResultRows,
    pstoResultSaveBlockReason,
    managedPstoResultRows,
  }
}
