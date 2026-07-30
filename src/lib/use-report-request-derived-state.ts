import { useMemo } from 'react'
import {
  getLnkRequestManagerOptions,
  getLnkRequestOptions,
  getLnkResultRequestOptions,
  getLnkResultSelectedRows,
  getManagedLnkRequestMethods,
  getManagedLnkRequestRows,
  getManagedPstoRequestRows,
  getNextLnkConclusionName,
  getNextLnkRequestName,
  getNextPstoDiagramName,
  getNextPstoRequestName,
  getPstoRequestManagerOptions,
  getPstoRequestOptions,
  getPstoResultRequestOptions,
  getPstoResultSelectedRows,
  getSelectedLnkMethodKeys,
  getSelectedLnkRequestTargetCount,
  getSelectedLnkResultRequestRows,
  getSelectedPstoResultRequestRows,
  getSelectedRowsByIds,
} from '@/lib/report-request-derived-utils'
import type { LnkRequestDraftState, LnkResultDraftState, PstoResultDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RequestConclusionSettings } from '@/lib/request-conclusion-settings'

interface ReportRequestDerivedStateOptions {
  enableLnkRequestState?: boolean
  enableLnkResultState?: boolean
  enablePstoRequestState?: boolean
  enablePstoResultState?: boolean
  rows: WeldRow[]
  heatTreatmentRows: WeldRow[]
  lnkRows: WeldRow[]
  availablePstoRequestRows: WeldRow[]
  availableLnkRequestRows: WeldRow[]
  selectedHeatTreatmentIds: Set<number>
  selectedLnkIds: Set<number>
  pstoRequestDate: string
  lnkRequestDraft: LnkRequestDraftState
  pstoResultDraft: PstoResultDraftState
  lnkResultDraft: LnkResultDraftState
  managedPstoRequestName: string
  managedLnkRequestName: string
  requestConclusionSettings: RequestConclusionSettings
}

export function useReportRequestDerivedState({
  enableLnkRequestState = true,
  enableLnkResultState = true,
  enablePstoRequestState = true,
  enablePstoResultState = true,
  rows,
  heatTreatmentRows,
  lnkRows,
  availablePstoRequestRows,
  availableLnkRequestRows,
  selectedHeatTreatmentIds,
  selectedLnkIds,
  pstoRequestDate,
  lnkRequestDraft,
  pstoResultDraft,
  lnkResultDraft,
  managedPstoRequestName,
  managedLnkRequestName,
  requestConclusionSettings,
}: ReportRequestDerivedStateOptions) {
  const selectedHeatTreatmentRows = useMemo(
    () => (enablePstoRequestState ? getSelectedRowsByIds(availablePstoRequestRows, selectedHeatTreatmentIds) : []),
    [availablePstoRequestRows, enablePstoRequestState, selectedHeatTreatmentIds],
  )
  const selectedLnkRows = useMemo(
    () => (enableLnkRequestState ? getSelectedRowsByIds(availableLnkRequestRows, selectedLnkIds) : []),
    [availableLnkRequestRows, enableLnkRequestState, selectedLnkIds],
  )
  const selectedLnkMethodKeys = useMemo(() => getSelectedLnkMethodKeys(lnkRequestDraft), [lnkRequestDraft.methods])
  const selectedLnkRequestTargetCount = useMemo(
    () => (enableLnkRequestState ? getSelectedLnkRequestTargetCount(selectedLnkRows, selectedLnkMethodKeys) : 0),
    [enableLnkRequestState, selectedLnkMethodKeys, selectedLnkRows],
  )
  const nextPstoRequestName = useMemo(
    () => (enablePstoRequestState ? getNextPstoRequestName(heatTreatmentRows, requestConclusionSettings, pstoRequestDate) : ''),
    [enablePstoRequestState, heatTreatmentRows, pstoRequestDate, requestConclusionSettings],
  )
  const nextLnkRequestName = useMemo(
    () => (enableLnkRequestState ? getNextLnkRequestName(rows, requestConclusionSettings, lnkRequestDraft.requestDate) : ''),
    [enableLnkRequestState, lnkRequestDraft.requestDate, requestConclusionSettings, rows],
  )
  const pstoRequestOptions = useMemo(() => (enablePstoRequestState || enablePstoResultState ? getPstoRequestOptions(rows) : []), [
    enablePstoRequestState,
    enablePstoResultState,
    rows,
  ])
  const pstoRequestManagerOptions = useMemo(
    () => (enablePstoRequestState ? getPstoRequestManagerOptions(pstoRequestOptions) : []),
    [enablePstoRequestState, pstoRequestOptions],
  )
  const managedPstoRequestRows = useMemo(
    () => (enablePstoRequestState ? getManagedPstoRequestRows(heatTreatmentRows, managedPstoRequestName) : []),
    [enablePstoRequestState, heatTreatmentRows, managedPstoRequestName],
  )
  const pstoResultRequestOptions = useMemo(
    () => (enablePstoResultState ? getPstoResultRequestOptions(heatTreatmentRows) : []),
    [enablePstoResultState, heatTreatmentRows],
  )
  const lnkRequestOptions = useMemo(() => (enableLnkRequestState || enableLnkResultState ? getLnkRequestOptions(rows) : []), [
    enableLnkRequestState,
    enableLnkResultState,
    rows,
  ])
  const lnkRequestManagerOptions = useMemo(
    () => (enableLnkRequestState ? getLnkRequestManagerOptions(lnkRequestOptions) : []),
    [enableLnkRequestState, lnkRequestOptions],
  )
  const lnkResultRequestOptions = useMemo(() => (enableLnkResultState ? getLnkResultRequestOptions(lnkRows) : []), [
    enableLnkResultState,
    lnkRows,
  ])
  const managedLnkRequestRows = useMemo(
    () => (enableLnkRequestState ? getManagedLnkRequestRows(lnkRows, managedLnkRequestName) : []),
    [enableLnkRequestState, lnkRows, managedLnkRequestName],
  )
  const managedLnkRequestMethods = useMemo(
    () => (enableLnkRequestState ? getManagedLnkRequestMethods(managedLnkRequestRows, managedLnkRequestName) : []),
    [enableLnkRequestState, managedLnkRequestName, managedLnkRequestRows],
  )
  const nextLnkConclusionName = useMemo(
    () => (enableLnkResultState ? getNextLnkConclusionName(rows, lnkResultDraft, requestConclusionSettings) : ''),
    [enableLnkResultState, lnkResultDraft, requestConclusionSettings, rows],
  )
  const nextPstoDiagramName = useMemo(
    () => (enablePstoResultState ? getNextPstoDiagramName(rows, pstoResultDraft, requestConclusionSettings) : ''),
    [enablePstoResultState, pstoResultDraft, requestConclusionSettings, rows],
  )
  const selectedPstoResultRequestRows = useMemo(
    () => (enablePstoResultState ? getSelectedPstoResultRequestRows(heatTreatmentRows, pstoResultDraft) : []),
    [enablePstoResultState, heatTreatmentRows, pstoResultDraft],
  )
  const pstoResultSelectedRows = useMemo(
    () => (enablePstoResultState ? getPstoResultSelectedRows(heatTreatmentRows, pstoResultDraft) : []),
    [enablePstoResultState, heatTreatmentRows, pstoResultDraft],
  )
  const selectedLnkResultRequestRows = useMemo(
    () => (enableLnkResultState ? getSelectedLnkResultRequestRows(lnkRows, lnkResultDraft) : []),
    [enableLnkResultState, lnkResultDraft, lnkRows],
  )
  const lnkResultSelectedRows = useMemo(
    () => (enableLnkResultState ? getLnkResultSelectedRows(lnkRows, lnkResultDraft) : []),
    [enableLnkResultState, lnkResultDraft, lnkRows],
  )

  return {
    selectedHeatTreatmentRows,
    selectedLnkRows,
    selectedLnkMethodKeys,
    selectedLnkRequestTargetCount,
    nextPstoRequestName,
    nextLnkRequestName,
    pstoRequestOptions,
    pstoRequestManagerOptions,
    managedPstoRequestRows,
    pstoResultRequestOptions,
    lnkRequestOptions,
    lnkRequestManagerOptions,
    lnkResultRequestOptions,
    managedLnkRequestRows,
    managedLnkRequestMethods,
    nextLnkConclusionName,
    nextPstoDiagramName,
    selectedPstoResultRequestRows,
    pstoResultSelectedRows,
    selectedLnkResultRequestRows,
    lnkResultSelectedRows,
  }
}
