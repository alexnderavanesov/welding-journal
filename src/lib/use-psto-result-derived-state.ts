import { useMemo } from 'react'
import type { PstoResultDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { SaveCheckSettings } from '@/lib/save-check-settings'
import {
  getFilteredPstoResultRequestOptions,
  getFilteredPstoResultRows,
  getManagedPstoResultRows,
  getPstoResultAvailableRequestOptions,
  getPstoResultSaveBlockReason,
  getPstoResultSearchRows,
  getSelectedPstoResultRows,
} from '@/lib/psto-result-derived-utils'
import type { RequestDocumentIdentity } from '@/lib/request-document-identity'
import type { RequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { buildSystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'

type PstoResultDerivedStateParams = {
  heatTreatmentRows: WeldRow[]
  pstoResultSelectedRows: WeldRow[]
  pstoResultRequestOptions: RequestDocumentIdentity[]
  pstoResultRequestSearch: string
  selectedPstoResultRequestRows: WeldRow[]
  pstoResultDraft: PstoResultDraftState
  nextPstoDiagramName: string
  nextPstoConclusionNumber?: number
  requestConclusionSettings: RequestConclusionSettings
  isPstoResultSaving: boolean
  saveCheckSettings: SaveCheckSettings
}

export function usePstoResultDerivedState({
  heatTreatmentRows,
  pstoResultSelectedRows,
  pstoResultRequestOptions,
  pstoResultRequestSearch,
  selectedPstoResultRequestRows,
  pstoResultDraft,
  nextPstoDiagramName,
  nextPstoConclusionNumber,
  requestConclusionSettings,
  isPstoResultSaving,
  saveCheckSettings,
}: PstoResultDerivedStateParams) {
  const pstoResultAvailableRequestOptions = useMemo(
    () => getPstoResultAvailableRequestOptions(pstoResultSelectedRows, pstoResultRequestOptions),
    [pstoResultRequestOptions, pstoResultSelectedRows],
  )

  const filteredPstoResultRequestOptions = useMemo(
    () => getFilteredPstoResultRequestOptions(pstoResultAvailableRequestOptions, pstoResultRequestSearch),
    [pstoResultAvailableRequestOptions, pstoResultRequestSearch],
  )

  const pstoResultSearchRows = useMemo(
    () => getPstoResultSearchRows({
      heatTreatmentRows,
      selectedRequestRows: selectedPstoResultRequestRows,
      requestName: pstoResultDraft.requestName,
    }),
    [heatTreatmentRows, pstoResultDraft.requestName, selectedPstoResultRequestRows],
  )

  const filteredPstoResultRows = useMemo(
    () => getFilteredPstoResultRows(pstoResultSearchRows, pstoResultDraft.search),
    [pstoResultDraft.search, pstoResultSearchRows],
  )

  const selectedPstoResultRows = useMemo(
    () => getSelectedPstoResultRows(pstoResultSearchRows, pstoResultDraft),
    [
      pstoResultSearchRows,
      pstoResultDraft.requestDate,
      pstoResultDraft.requestName,
      pstoResultDraft.rowIds,
    ],
  )

  const systemDocumentCreationPlan = useMemo(() =>
    buildSystemDocumentCreationPlan({
      type: 'pstoConclusion',
      date: pstoResultDraft.pstoDate,
      rows: selectedPstoResultRows,
      naming: pstoResultDraft.diagramNaming,
      settings: requestConclusionSettings,
      nextNumber: nextPstoConclusionNumber,
      allowAllNamesEmpty: !saveCheckSettings.pstoResultDiagramRequired,
    }),
  [
    nextPstoConclusionNumber,
    pstoResultDraft.diagramNaming,
    pstoResultDraft.pstoDate,
    requestConclusionSettings,
    saveCheckSettings.pstoResultDiagramRequired,
    selectedPstoResultRows,
  ])

  const pstoResultSaveBlockReason = useMemo(
    () =>
      getPstoResultSaveBlockReason({
        draft: pstoResultDraft,
        isSaving: isPstoResultSaving,
        nextDiagramName: nextPstoDiagramName,
        saveCheckSettings,
        selectedRows: selectedPstoResultRows,
        systemDocumentCreationPlan,
      }),
    [isPstoResultSaving, nextPstoDiagramName, pstoResultDraft, saveCheckSettings, selectedPstoResultRows, systemDocumentCreationPlan],
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
    systemDocumentCreationPlan,
    pstoResultSaveBlockReason,
    managedPstoResultRows,
  }
}
